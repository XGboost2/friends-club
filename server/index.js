import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { CLUB_TZ, query, tx, migrate, cleanupOldRecords, storageStats } from "./db.js";
import { renderPage, robotsTxt, sitemapXml } from "./seo.js";
import { sendOtp } from "./email.js";

const app = new Hono();
const isProd = process.env.NODE_ENV === "production";
const COOKIE = "fc_admin";
const PLAYER_COOKIE = "fc_player";
const SESSION_DAYS = 30;
const PLAYER_SESSION_DAYS = 90;
const CANCEL_LOCK_HOURS = 25;
const AUTO_CLOSE_HOURS = 24;
const OTP_TTL_MINUTES = 10;
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 30;

// ---------- helpers ----------
const cardKey = (value) => (value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");
const bad = (c, message, status = 400) => c.json({ error: message }, status);

async function parseBody(c, schema) {
  let raw;
  try { raw = await c.req.json(); } catch { raw = {}; }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    return { error: first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input" };
  }
  return { data: result.data };
}

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "use HH:MM");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD");

function mapSession(row) {
  return {
    id: row.id,
    date: row.date,
    startTime: row.start_time,
    endTime: row.end_time,
    venue: row.venue,
    capacity: row.capacity,
    courtsCount: row.courts_count,
    courtNumbers: row.court_numbers,
    notes: row.notes,
    status: row.status,
    playerCount: Number(row.player_count ?? 0),
    guestCount: Number(row.guest_count ?? 0),
    total: Number(row.player_count ?? 0) + Number(row.guest_count ?? 0),
    players: row.players ?? [],
  };
}

function mapPlayer(row) {
  return { id: row.id, email: row.email, phone: row.phone, name: row.name, level: row.level, blocked: row.blocked, createdAt: row.created_at };
}

/** Close voting for any session starting within AUTO_CLOSE_HOURS. Safe to call frequently. */
async function autoClosePolls() {
  await query(
    `UPDATE sessions SET status = 'closed'
     WHERE status = 'open'
       AND ((date::text || ' ' || start_time)::timestamp AT TIME ZONE '${CLUB_TZ}') <= now() + interval '${AUTO_CLOSE_HOURS} hours'`,
  );
}

const SESSION_STATS_SQL = `
  SELECT s.*,
    ((s.date::text || ' ' || s.start_time)::timestamp AT TIME ZONE '${CLUB_TZ}') AS start_at,
    (SELECT count(*) FROM registrations r WHERE r.session_id = s.id) AS player_count,
    (SELECT count(*) FROM guests g JOIN registrations r ON r.id = g.registration_id WHERE r.session_id = s.id) AS guest_count,
    COALESCE((SELECT json_agg(r.player_name ORDER BY r.created_at) FROM registrations r WHERE r.session_id = s.id), '[]'::json) AS players
  FROM sessions s`;

// ---------- player auth ----------
async function currentPlayer(c) {
  const token = getCookie(c, PLAYER_COOKIE);
  if (!token) return null;
  const { rows } = await query(
    `SELECT p.* FROM player_sessions s JOIN players p ON p.id = s.player_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND NOT p.blocked`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

async function issuePlayerSession(c, playerId) {
  const token = crypto.randomBytes(32).toString("hex");
  await query(
    `INSERT INTO player_sessions (token_hash, player_id, expires_at) VALUES ($1, $2, now() + interval '${PLAYER_SESSION_DAYS} days')`,
    [hashToken(token), playerId],
  );
  setCookie(c, PLAYER_COOKIE, token, { httpOnly: true, secure: isProd, sameSite: "Lax", path: "/", maxAge: PLAYER_SESSION_DAYS * 86400 });
}

const emailSchema = z.string().trim().toLowerCase().email("enter a valid email");
const phoneSchema = z.string().trim().min(6, "enter a valid phone number").max(30);
const levelSchema = z.enum(["beginner", "intermediate", "advanced"]);
const nameSchema = z.string().trim().min(1, "enter your name").max(60);
const purposeSchema = z.enum(["register", "login"]);

app.post("/api/auth/request-otp", async (c) => {
  const { data, error } = await parseBody(c, z.object({ email: emailSchema, purpose: purposeSchema }));
  if (error) return bad(c, error);
  const existing = (await query(`SELECT id, blocked FROM players WHERE email = $1`, [data.email])).rows[0];
  if (data.purpose === "register" && existing) return bad(c, "An account with this email already exists. Sign in instead.", 409);
  if (data.purpose === "login" && !existing) return bad(c, "No account found for that email. Register first.", 404);
  if (existing?.blocked) return bad(c, "This account has been blocked. Contact an admin.", 403);

  const last = (await query(`SELECT created_at FROM otp_codes WHERE email = $1 AND purpose = $2`, [data.email, data.purpose])).rows[0];
  if (last) {
    const secs = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (secs < OTP_RESEND_COOLDOWN_SECONDS) {
      return bad(c, `Wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - secs)}s before requesting another code.`, 429);
    }
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = await bcrypt.hash(code, 10);
  await query(
    `INSERT INTO otp_codes (email, purpose, code_hash, attempts, expires_at, created_at)
     VALUES ($1, $2, $3, 0, now() + interval '${OTP_TTL_MINUTES} minutes', now())
     ON CONFLICT (email, purpose) DO UPDATE
       SET code_hash = EXCLUDED.code_hash, attempts = 0, expires_at = EXCLUDED.expires_at, created_at = now()`,
    [data.email, data.purpose, codeHash],
  );
  try {
    await sendOtp(data.email, code, data.purpose, OTP_TTL_MINUTES);
  } catch (e) {
    console.error("sendOtp failed", e);
    return bad(c, "We couldn't send the code right now. Try again in a moment.", 502);
  }
  return c.json({ ok: true, expiresInMinutes: OTP_TTL_MINUTES });
});

app.post("/api/auth/verify-otp", async (c) => {
  const { data, error } = await parseBody(c, z.object({
    email: emailSchema,
    purpose: purposeSchema,
    code: z.string().trim().regex(/^\d{6}$/, "enter the 6-digit code"),
    // register only:
    name: nameSchema.optional(),
    phone: phoneSchema.optional(),
    level: levelSchema.optional(),
  }));
  if (error) return bad(c, error);

  const otp = (await query(`SELECT * FROM otp_codes WHERE email = $1 AND purpose = $2`, [data.email, data.purpose])).rows[0];
  if (!otp) return bad(c, "Request a code first.", 400);
  if (new Date(otp.expires_at).getTime() < Date.now()) {
    await query(`DELETE FROM otp_codes WHERE email = $1 AND purpose = $2`, [data.email, data.purpose]);
    return bad(c, "That code has expired. Request a new one.", 410);
  }
  if (otp.attempts >= OTP_MAX_ATTEMPTS) {
    await query(`DELETE FROM otp_codes WHERE email = $1 AND purpose = $2`, [data.email, data.purpose]);
    return bad(c, "Too many wrong attempts. Request a new code.", 429);
  }
  const match = await bcrypt.compare(data.code, otp.code_hash);
  if (!match) {
    await query(`UPDATE otp_codes SET attempts = attempts + 1 WHERE email = $1 AND purpose = $2`, [data.email, data.purpose]);
    return bad(c, "Wrong code. Try again.", 401);
  }
  // Code good: consume it.
  await query(`DELETE FROM otp_codes WHERE email = $1 AND purpose = $2`, [data.email, data.purpose]);

  let player;
  if (data.purpose === "register") {
    if (!data.name || !data.phone || !data.level) return bad(c, "Enter your name, phone, and level.", 400);
    try {
      player = (await query(
        `INSERT INTO players (email, phone, name, level) VALUES ($1, $2, $3, $4) RETURNING *`,
        [data.email, data.phone, data.name, data.level],
      )).rows[0];
    } catch (e) {
      if (e.code === "23505") return bad(c, "An account with this email already exists. Sign in instead.", 409);
      throw e;
    }
  } else {
    player = (await query(`SELECT * FROM players WHERE email = $1`, [data.email])).rows[0];
    if (!player) return bad(c, "Account not found.", 404);
    if (player.blocked) return bad(c, "This account has been blocked. Contact an admin.", 403);
  }

  await issuePlayerSession(c, player.id);
  return c.json({ player: mapPlayer(player) });
});

app.post("/api/auth/logout", async (c) => {
  const token = getCookie(c, PLAYER_COOKIE);
  if (token) await query(`DELETE FROM player_sessions WHERE token_hash = $1`, [hashToken(token)]);
  deleteCookie(c, PLAYER_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const player = await currentPlayer(c);
  return c.json({ player: player ? mapPlayer(player) : null });
});

// ---------- public API ----------
app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/sessions", async (c) => {
  await autoClosePolls();
  const { rows } = await query(`${SESSION_STATS_SQL} WHERE s.date >= current_date ORDER BY s.date, s.start_time`);
  const today = (await query(`SELECT current_date AS d`)).rows[0].d;
  return c.json({ today, sessions: rows.map(mapSession) });
});

app.get("/api/sessions/:id/attendees", async (c) => {
  const id = Number(c.req.param("id"));
  const { rows } = await query(
    `SELECT r.player_name, r.uses_multisport,
       COALESCE((SELECT json_agg(json_build_object('name', g.name, 'multisport', g.uses_multisport) ORDER BY g.id)
          FROM guests g WHERE g.registration_id = r.id), '[]'::json) AS guests
     FROM registrations r WHERE r.session_id = $1 ORDER BY r.created_at`,
    [id],
  );
  return c.json({ attendees: rows.map((r) => ({ name: r.player_name, multisport: r.uses_multisport, guests: r.guests })) });
});

const guestSchema = z.object({
  name: z.string().trim().min(1, "guest name required").max(60),
  usesMultisport: z.boolean().default(false),
  cardNumber: z.string().trim().max(40).optional().nullable(),
  holderName: z.string().trim().max(80).optional().nullable(),
});

const joinSchema = z.object({
  usesMultisport: z.boolean(),
  cardNumber: z.string().trim().max(40).optional().nullable(),
  holderName: z.string().trim().max(80).optional().nullable(),
  guests: z.array(guestSchema).max(10).default([]),
});

app.post("/api/sessions/:id/join", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in to join a session.", 401);
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, joinSchema);
  if (error) return bad(c, error);
  if (data.usesMultisport) {
    if (cardKey(data.cardNumber).length < 6) return bad(c, "Enter your Multisport card number (at least 6 characters).");
    if (!data.holderName) return bad(c, "Enter the name on the Multisport card.");
  }
  for (const g of data.guests) {
    if (g.usesMultisport) {
      if (cardKey(g.cardNumber).length < 6) return bad(c, `Enter a Multisport card number for guest "${g.name}" (at least 6 characters).`);
      if (!g.holderName) return bad(c, `Enter the name on the Multisport card for guest "${g.name}".`);
    }
  }
  // Detect duplicate cards inside the same submission (player + guests + between guests).
  const submittedCards = new Set();
  const addCard = (key) => {
    if (!key) return true;
    if (submittedCards.has(key)) return false;
    submittedCards.add(key);
    return true;
  };
  if (data.usesMultisport && !addCard(cardKey(data.cardNumber))) return bad(c, "The same Multisport card can't be used twice in one booking.");
  for (const g of data.guests) {
    if (g.usesMultisport && !addCard(cardKey(g.cardNumber))) return bad(c, `The same Multisport card can't be used twice in one booking.`);
  }
  try {
    const result = await tx(async (client) => {
      const s = (await client.query(`SELECT * FROM sessions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!s) return { status: 404, error: "This session no longer exists." };
      if (s.status !== "open") return { status: 409, error: "Voting for this session is closed." };
      const timing = (await client.query(
        `SELECT $1::date < current_date AS past,
                ((($1::text || ' ' || $2::text)::timestamp AT TIME ZONE $3) <= now() + interval '${AUTO_CLOSE_HOURS} hours') AS closing_soon`,
        [s.date, s.start_time, CLUB_TZ],
      )).rows[0];
      if (timing.past) return { status: 409, error: "This session is in the past." };
      if (timing.closing_soon) {
        // Race: someone joined between auto-close sweeps. Persist the close and reject.
        await client.query(`UPDATE sessions SET status = 'closed' WHERE id = $1`, [id]);
        return { status: 409, error: `Voting closes ${AUTO_CLOSE_HOURS} hours before the session.` };
      }
      const existing = (await client.query(`SELECT id FROM registrations WHERE session_id = $1 AND player_id = $2`, [id, player.id])).rows[0];
      if (existing) return { status: 409, error: "You're already in this session." };
      // Card collision check: block if any card in this booking is already booked for this session.
      const cardsToCheck = [];
      if (data.usesMultisport) cardsToCheck.push(cardKey(data.cardNumber));
      for (const g of data.guests) if (g.usesMultisport) cardsToCheck.push(cardKey(g.cardNumber));
      if (cardsToCheck.length) {
        const clash = (await client.query(
          `SELECT 1
             FROM registrations r
             WHERE r.session_id = $1 AND r.card_key = ANY($2::text[])
           UNION ALL
           SELECT 1
             FROM guests g JOIN registrations r ON r.id = g.registration_id
             WHERE r.session_id = $1 AND g.card_key = ANY($2::text[])`,
          [id, cardsToCheck],
        )).rows[0];
        if (clash) return { status: 409, error: "A Multisport card in this booking is already registered for this session." };
      }
      const counts = (await client.query(
        `SELECT (SELECT count(*) FROM registrations WHERE session_id = $1) +
                (SELECT count(*) FROM guests g JOIN registrations r ON r.id = g.registration_id WHERE r.session_id = $1) AS total`,
        [id],
      )).rows[0];
      const spotsLeft = s.capacity - Number(counts.total);
      const needed = 1 + data.guests.length;
      if (needed > spotsLeft) {
        return { status: 409, error: spotsLeft <= 0 ? "Sorry, this session is full." : `Only ${spotsLeft} spot${spotsLeft === 1 ? "" : "s"} left.` };
      }
      const reg = (await client.query(
        `INSERT INTO registrations (session_id, player_id, player_name, uses_multisport, card_number, card_key, holder_name)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [id, player.id, player.name, data.usesMultisport,
          data.usesMultisport ? data.cardNumber.trim() : null,
          data.usesMultisport ? cardKey(data.cardNumber) : null,
          data.usesMultisport ? data.holderName : null],
      )).rows[0];
      for (const guest of data.guests) {
        await client.query(
          `INSERT INTO guests (registration_id, name, uses_multisport, card_number, card_key, holder_name)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [reg.id, guest.name, guest.usesMultisport,
            guest.usesMultisport ? guest.cardNumber.trim() : null,
            guest.usesMultisport ? cardKey(guest.cardNumber) : null,
            guest.usesMultisport ? guest.holderName : null],
        );
      }
      return { ok: true };
    });
    if (result.error) return bad(c, result.error, result.status);
    const session = (await query(`${SESSION_STATS_SQL} WHERE s.id = $1`, [id])).rows[0];
    return c.json({ ok: true, session: mapSession(session) });
  } catch (e) {
    if (e.code === "23505") return bad(c, "You're already in this session.", 409);
    throw e;
  }
});

app.post("/api/sessions/:id/leave", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in to manage your bookings.", 401);
  const id = Number(c.req.param("id"));
  const session = (await query(
    `SELECT ((date::text || ' ' || start_time)::timestamp AT TIME ZONE $1) > now() + interval '${CANCEL_LOCK_HOURS} hours' AS can_leave
       FROM sessions WHERE id = $2`,
    [CLUB_TZ, id],
  )).rows[0];
  if (!session) return bad(c, "This session no longer exists.", 404);
  if (!session.can_leave) return bad(c, `Too late to cancel — sessions lock ${CANCEL_LOCK_HOURS} hours before the start time.`, 409);
  const { rowCount } = await query(
    `DELETE FROM registrations WHERE session_id = $1 AND player_id = $2`,
    [id, player.id],
  );
  if (!rowCount) return bad(c, "Booking not found.", 404);
  return c.json({ ok: true });
});

app.get("/api/my-sessions", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return c.json({ sessions: [] });
  const { rows } = await query(
    `${SESSION_STATS_SQL}
     JOIN registrations me ON me.session_id = s.id
     WHERE s.date >= current_date AND me.player_id = $1
     ORDER BY s.date, s.start_time`,
    [player.id],
  );
  const mine = await query(
    `SELECT r.session_id, r.uses_multisport, r.status,
       COALESCE((SELECT json_agg(g.name ORDER BY g.id) FROM guests g WHERE g.registration_id = r.id), '[]'::json) AS guests
     FROM registrations r WHERE r.player_id = $1`,
    [player.id],
  );
  const bySession = new Map(mine.rows.map((r) => [r.session_id, r]));
  const cutoffMs = CANCEL_LOCK_HOURS * 3_600_000;
  return c.json({
    sessions: rows.map((row) => {
      const me = bySession.get(row.id);
      if (!me) return { ...mapSession(row), me: null };
      const beforeCutoff = row.start_at ? new Date(row.start_at).getTime() - Date.now() > cutoffMs : false;
      return {
        ...mapSession(row),
        me: {
          multisport: me.uses_multisport,
          status: me.status,
          guests: me.guests,
          isMine: true,
          canLeave: beforeCutoff,
        },
      };
    }),
  });
});

// ---------- tournaments (public + player) ----------
const TOURNAMENT_LOCK_DAYS = 3;
const FORMATS = ["singles", "doubles", "mixed"];
const LEVELS = ["beginner", "intermediate", "advanced"];

function mapTournament(row) {
  return {
    id: row.id,
    name: row.name,
    startsOn: row.starts_on,
    startTime: row.start_time,
    venue: row.venue,
    description: row.description,
    status: row.status,
    createdAt: row.created_at,
  };
}

function needsPartner(format) { return format !== "singles"; }

async function tournamentWithCategories(tournamentId, opts = {}) {
  const t = (await query(`SELECT * FROM tournaments WHERE id = $1`, [tournamentId])).rows[0];
  if (!t) return null;
  const cats = (await query(
    `SELECT c.*,
       (SELECT count(*) FROM tournament_registrations r WHERE r.category_id = c.id) AS entry_count
     FROM tournament_categories c WHERE c.tournament_id = $1
     ORDER BY c.level, c.format`,
    [tournamentId],
  )).rows.map((c) => ({
    id: c.id,
    format: c.format,
    level: c.level,
    isOpen: c.is_open,
    maxEntries: c.max_entries,
    entryCount: Number(c.entry_count),
  }));
  const players = opts.withPlayers
    ? (await query(`SELECT id, name, level FROM players WHERE NOT blocked ORDER BY lower(name)`)).rows
    : undefined;
  return { ...mapTournament(t), categories: cats, players };
}

async function myTournamentEntries(playerId, tournamentId) {
  const { rows } = await query(
    `SELECT r.*, c.format, c.level, c.tournament_id,
       me.name AS me_name,
       COALESCE(p.name, r.partner_name) AS partner_display
     FROM tournament_registrations r
     JOIN tournament_categories c ON c.id = r.category_id
     JOIN players me ON me.id = r.player_id
     LEFT JOIN players p ON p.id = r.partner_id
     WHERE c.tournament_id = $1 AND (r.player_id = $2 OR r.partner_id = $2)`,
    [tournamentId, playerId],
  );
  return rows.map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    format: r.format,
    level: r.level,
    playerId: r.player_id,
    playerName: r.me_name,
    partnerId: r.partner_id,
    partnerName: r.partner_display,
    partnerRegistered: r.partner_id != null,
    createdAt: r.created_at,
    imOwner: r.player_id === playerId,
  }));
}

app.get("/api/tournaments", async (c) => {
  const { rows } = await query(
    `SELECT * FROM tournaments WHERE status IN ('open','closed') AND starts_on >= current_date - 1
     ORDER BY starts_on`,
  );
  return c.json({ tournaments: rows.map(mapTournament) });
});

app.get("/api/tournaments/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const detail = await tournamentWithCategories(id, { withPlayers: true });
  if (!detail || detail.status === "draft") return bad(c, "Tournament not found.", 404);
  const player = await currentPlayer(c);
  const mine = player ? await myTournamentEntries(player.id, id) : [];
  return c.json({ tournament: detail, mine });
});

async function assertTournamentOpen(client, categoryId) {
  const row = (await client.query(
    `SELECT c.id, c.is_open, c.max_entries, c.format, c.level, t.status, t.starts_on
     FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id
     WHERE c.id = $1 FOR UPDATE`,
    [categoryId],
  )).rows[0];
  if (!row) return { error: "Category not found.", status: 404 };
  if (row.status !== "open") return { error: "This tournament isn't open for entries yet.", status: 409 };
  if (!row.is_open) return { error: "That category is closed.", status: 409 };
  return { row };
}

async function assertBeforeLock(client, categoryId) {
  const { rows } = await client.query(
    `SELECT (t.starts_on - interval '${TOURNAMENT_LOCK_DAYS} days')::date > current_date AS can_change
     FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id
     WHERE c.id = $1`,
    [categoryId],
  );
  return rows[0]?.can_change;
}

const partnerNameSchema = z.string().trim().min(1).max(60);
const registerSchema = z.object({
  categoryId: z.number().int(),
  partnerId: z.number().int().optional().nullable(),
  partnerName: partnerNameSchema.optional().nullable(),
});

app.post("/api/tournaments/register", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in to register.", 401);
  const { data, error } = await parseBody(c, registerSchema);
  if (error) return bad(c, error);
  try {
    const result = await tx(async (client) => {
      const check = await assertTournamentOpen(client, data.categoryId);
      if (check.error) return check;
      const cat = check.row;
      const hasPartner = data.partnerId != null || (data.partnerName && data.partnerName.trim());
      if (needsPartner(cat.format) && !hasPartner) return { error: "Pick a partner for this category.", status: 400 };
      if (!needsPartner(cat.format) && hasPartner) return { error: "Singles category doesn't take a partner.", status: 400 };
      if (data.partnerId != null && data.partnerName) return { error: "Pick an existing player or type a name — not both.", status: 400 };
      if (data.partnerId === player.id) return { error: "You can't be your own partner.", status: 400 };
      if (data.partnerId) {
        const partner = (await client.query(`SELECT id, blocked FROM players WHERE id = $1`, [data.partnerId])).rows[0];
        if (!partner || partner.blocked) return { error: "That partner isn't available.", status: 400 };
        const already = (await client.query(
          `SELECT id FROM tournament_registrations
           WHERE category_id = $1 AND (player_id = $2 OR partner_id = $2)`,
          [data.categoryId, data.partnerId],
        )).rows[0];
        if (already) return { error: "That player is already in this category.", status: 409 };
      }
      if (cat.max_entries) {
        const count = Number((await client.query(
          `SELECT count(*) AS n FROM tournament_registrations WHERE category_id = $1`,
          [data.categoryId],
        )).rows[0].n);
        if (count >= cat.max_entries) return { error: "This category is full.", status: 409 };
      }
      const row = (await client.query(
        `INSERT INTO tournament_registrations (category_id, player_id, partner_id, partner_name)
         VALUES ($1,$2,$3,$4) RETURNING id`,
        [data.categoryId, player.id, data.partnerId || null, data.partnerId ? null : (data.partnerName?.trim() || null)],
      )).rows[0];
      return { ok: true, id: row.id };
    });
    if (result.error) return bad(c, result.error, result.status);
    return c.json({ ok: true, id: result.id });
  } catch (e) {
    if (e.code === "23505") return bad(c, "You (or your partner) are already in that category.", 409);
    throw e;
  }
});

app.patch("/api/tournaments/registrations/:id", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in.", 401);
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, z.object({
    partnerId: z.number().int().nullable().optional(),
    partnerName: partnerNameSchema.nullable().optional(),
  }));
  if (error) return bad(c, error);
  if (data.partnerId != null && data.partnerName) return bad(c, "Pick an existing player or type a name — not both.");
  try {
    const result = await tx(async (client) => {
      const reg = (await client.query(
        `SELECT r.*, c.format FROM tournament_registrations r
         JOIN tournament_categories c ON c.id = r.category_id
         WHERE r.id = $1 FOR UPDATE`,
        [id],
      )).rows[0];
      if (!reg) return { error: "Registration not found.", status: 404 };
      if (reg.player_id !== player.id) return { error: "Only the person who booked this entry can change the partner.", status: 403 };
      if (!needsPartner(reg.format)) return { error: "Singles has no partner to change.", status: 400 };
      const canChange = await assertBeforeLock(client, reg.category_id);
      if (!canChange) return { error: `Partner changes lock ${TOURNAMENT_LOCK_DAYS} days before the tournament.`, status: 409 };
      if (data.partnerId === player.id) return { error: "You can't be your own partner.", status: 400 };
      if (data.partnerId != null) {
        const partner = (await client.query(`SELECT id, blocked FROM players WHERE id = $1`, [data.partnerId])).rows[0];
        if (!partner || partner.blocked) return { error: "That partner isn't available.", status: 400 };
        const clash = (await client.query(
          `SELECT id FROM tournament_registrations
           WHERE category_id = $1 AND id <> $2 AND (player_id = $3 OR partner_id = $3)`,
          [reg.category_id, id, data.partnerId],
        )).rows[0];
        if (clash) return { error: "That player is already in this category.", status: 409 };
      }
      const nextPartnerId = data.partnerId ?? null;
      const nextPartnerName = data.partnerId != null ? null : (data.partnerName?.trim() || null);
      if (!nextPartnerId && !nextPartnerName) return { error: "Pick a partner.", status: 400 };
      await client.query(
        `UPDATE tournament_registrations SET partner_id = $1, partner_name = $2 WHERE id = $3`,
        [nextPartnerId, nextPartnerName, id],
      );
      return { ok: true };
    });
    if (result.error) return bad(c, result.error, result.status);
    return c.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return bad(c, "That partner is already taken in this category.", 409);
    throw e;
  }
});

app.delete("/api/tournaments/registrations/:id", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in.", 401);
  const id = Number(c.req.param("id"));
  const result = await tx(async (client) => {
    const reg = (await client.query(
      `SELECT r.*, c.tournament_id FROM tournament_registrations r
       JOIN tournament_categories c ON c.id = r.category_id
       WHERE r.id = $1 FOR UPDATE`,
      [id],
    )).rows[0];
    if (!reg) return { error: "Registration not found.", status: 404 };
    if (reg.player_id !== player.id && reg.partner_id !== player.id) return { error: "Not your entry.", status: 403 };
    const canChange = await assertBeforeLock(client, reg.category_id);
    if (!canChange) return { error: `Withdrawals lock ${TOURNAMENT_LOCK_DAYS} days before the tournament.`, status: 409 };
    await client.query(`DELETE FROM tournament_registrations WHERE id = $1`, [id]);
    return { ok: true };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json({ ok: true });
});

// ---------- admin auth ----------
const loginAttempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, since: now };
  if (now - entry.since > 15 * 60 * 1000) { entry.count = 0; entry.since = now; }
  entry.count += 1;
  loginAttempts.set(ip, entry);
  return entry.count > 20;
}

async function createSession(c, adminId) {
  const token = crypto.randomBytes(32).toString("hex");
  await query(`INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [hashToken(token), adminId]);
  setCookie(c, COOKIE, token, { httpOnly: true, secure: isProd, sameSite: "Lax", path: "/", maxAge: SESSION_DAYS * 86400 });
}

async function currentAdmin(c) {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  const { rows } = await query(
    `SELECT a.id, a.email, a.approved FROM admin_sessions s JOIN admins a ON a.id = s.admin_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

const credentials = z.object({ email: z.string().trim().toLowerCase().email("enter a valid email"), password: z.string().min(8, "use at least 8 characters").max(200) });

app.post("/api/admin/signup", async (c) => {
  const ip = c.req.header("x-forwarded-for") || "local";
  if (tooManyAttempts(ip)) return bad(c, "Too many attempts. Try again in a few minutes.", 429);
  const { data, error } = await parseBody(c, credentials);
  if (error) return bad(c, error);
  const hash = await bcrypt.hash(data.password, 10);
  try {
    const admin = await tx(async (client) => {
      await client.query(`LOCK TABLE admins IN EXCLUSIVE MODE`);
      const first = Number((await client.query(`SELECT count(*) AS n FROM admins`)).rows[0].n) === 0;
      return (await client.query(
        `INSERT INTO admins (email, password_hash, approved) VALUES ($1, $2, $3) RETURNING id, email, approved`,
        [data.email, hash, first],
      )).rows[0];
    });
    await createSession(c, admin.id);
    return c.json({ admin });
  } catch (e) {
    if (e.code === "23505") return bad(c, "An account with this email already exists. Sign in instead.", 409);
    throw e;
  }
});

app.post("/api/admin/login", async (c) => {
  const ip = c.req.header("x-forwarded-for") || "local";
  if (tooManyAttempts(ip)) return bad(c, "Too many attempts. Try again in a few minutes.", 429);
  const { data, error } = await parseBody(c, z.object({ email: z.string().trim().toLowerCase(), password: z.string() }));
  if (error) return bad(c, error);
  const admin = (await query(`SELECT * FROM admins WHERE email = $1`, [data.email])).rows[0];
  if (!admin || !(await bcrypt.compare(data.password, admin.password_hash))) return bad(c, "Wrong email or password.", 401);
  await createSession(c, admin.id);
  return c.json({ admin: { id: admin.id, email: admin.email, approved: admin.approved } });
});

app.post("/api/admin/logout", async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await query(`DELETE FROM admin_sessions WHERE token_hash = $1`, [hashToken(token)]);
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/api/admin/me", async (c) => {
  const admin = await currentAdmin(c);
  return c.json({ admin });
});

// Everything below requires an approved admin.
app.use("/api/admin/*", async (c, next) => {
  const admin = await currentAdmin(c);
  if (!admin) return bad(c, "Please sign in.", 401);
  if (!admin.approved) return bad(c, "Your admin access is waiting for approval.", 403);
  c.set("admin", admin);
  await next();
});

// ---------- admin: polls ----------
app.get("/api/admin/sessions", async (c) => {
  cleanupOldRecords().catch(() => {});
  await autoClosePolls();
  const { rows } = await query(
    `SELECT x.*,
       (SELECT count(*) FROM registrations r WHERE r.session_id = x.id AND r.uses_multisport) AS multisport_count
     FROM (${SESSION_STATS_SQL} WHERE s.date >= current_date) x ORDER BY x.date, x.start_time`,
  );
  return c.json({ sessions: rows.map((r) => ({ ...mapSession(r), multisportCount: Number(r.multisport_count) })) });
});

const sessionFields = {
  startTime: time,
  endTime: time,
  venue: z.string().trim().min(1, "enter a venue").max(120),
  capacity: z.number().int().min(1).max(500),
  courtsCount: z.number().int().min(1).max(50),
  notes: z.string().trim().max(500).optional().nullable(),
};

app.post("/api/admin/sessions", async (c) => {
  const { data, error } = await parseBody(c, z.object({ dates: z.array(isoDate).min(1).max(60), ...sessionFields }));
  if (error) return bad(c, error);
  if (data.endTime <= data.startTime) return bad(c, "End time must be after start time.");
  const created = await tx(async (client) => {
    const ids = [];
    for (const date of [...new Set(data.dates)].sort()) {
      const row = (await client.query(
        `INSERT INTO sessions (date, start_time, end_time, venue, capacity, courts_count, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [date, data.startTime, data.endTime, data.venue, data.capacity, data.courtsCount, data.notes || null],
      )).rows[0];
      ids.push(row.id);
    }
    return ids;
  });
  return c.json({ created: created.length });
});

app.patch("/api/admin/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const schema = z.object({
    date: isoDate.optional(),
    startTime: time.optional(),
    endTime: time.optional(),
    venue: sessionFields.venue.optional(),
    capacity: sessionFields.capacity.optional(),
    courtsCount: sessionFields.courtsCount.optional(),
    notes: sessionFields.notes,
    courtNumbers: z.string().trim().max(60).optional().nullable(),
    status: z.enum(["open", "closed"]).optional(),
  });
  const { data, error } = await parseBody(c, schema);
  if (error) return bad(c, error);
  const columns = { date: "date", startTime: "start_time", endTime: "end_time", venue: "venue", capacity: "capacity", courtsCount: "courts_count", notes: "notes", courtNumbers: "court_numbers", status: "status" };
  const sets = [];
  const values = [];
  for (const [key, column] of Object.entries(columns)) {
    if (data[key] !== undefined) {
      values.push(key === "courtNumbers" || key === "notes" ? (data[key] || null) : data[key]);
      sets.push(`${column} = $${values.length}`);
    }
  }
  if (!sets.length) return bad(c, "Nothing to update.");
  values.push(id);
  const { rows } = await query(`UPDATE sessions SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) return bad(c, "Session not found.", 404);
  if (rows[0].end_time <= rows[0].start_time) return bad(c, "End time must be after start time.");
  return c.json({ ok: true });
});

app.delete("/api/admin/sessions/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await query(`DELETE FROM sessions WHERE id = $1`, [id]);
  return c.json({ ok: true });
});

async function sessionDetail(id) {
  const session = (await query(`${SESSION_STATS_SQL} WHERE s.id = $1`, [id])).rows[0];
  if (!session) return null;
  const { rows } = await query(
    `SELECT r.*, COALESCE((SELECT json_agg(json_build_object(
        'id', g.id, 'name', g.name, 'status', g.status,
        'multisport', g.uses_multisport, 'cardNumber', g.card_number, 'holderName', g.holder_name,
        'paidMethod', g.paid_method
      ) ORDER BY g.id)
        FROM guests g WHERE g.registration_id = r.id), '[]'::json) AS guests
     FROM registrations r WHERE r.session_id = $1 ORDER BY r.player_name`,
    [id],
  );
  return {
    ...mapSession(session),
    registrations: rows.map((r) => ({
      id: r.id,
      name: r.player_name,
      multisport: r.uses_multisport,
      cardNumber: r.card_number,
      holderName: r.holder_name,
      status: r.status,
      paidAt: r.paid_at,
      paidMethod: r.paid_method,
      guests: r.guests,
      createdAt: r.created_at,
    })),
  };
}

app.get("/api/admin/sessions/:id", async (c) => {
  const detail = await sessionDetail(Number(c.req.param("id")));
  if (!detail) return bad(c, "Session not found.", 404);
  return c.json({ session: detail });
});

// ---------- admin: check-in ----------
app.get("/api/admin/checkin/sessions", async (c) => {
  const { rows } = await query(`${SESSION_STATS_SQL} WHERE s.date BETWEEN current_date - 1 AND current_date + 1 ORDER BY s.date, s.start_time`);
  const today = (await query(`SELECT current_date AS d`)).rows[0].d;
  return c.json({ today, sessions: rows.map(mapSession) });
});

app.post("/api/admin/checkin/scan", async (c) => {
  const { data, error } = await parseBody(c, z.object({ sessionId: z.number().int(), code: z.string().trim().min(1).max(500) }));
  if (error) return bad(c, error);
  const scanned = cardKey(data.code);
  if (scanned.length < 4) return c.json({ result: "unknown", code: data.code });
  const { rows } = await query(
    `SELECT 'registration' AS kind, id, player_name AS name, card_key, status FROM registrations
       WHERE session_id = $1 AND uses_multisport AND card_key IS NOT NULL
     UNION ALL
     SELECT 'guest' AS kind, g.id, g.name, g.card_key, g.status FROM guests g
       JOIN registrations r ON r.id = g.registration_id
       WHERE r.session_id = $1 AND g.uses_multisport AND g.card_key IS NOT NULL`,
    [data.sessionId],
  );
  // Exact match first, then tolerate prefixes/suffixes that card barcodes sometimes add.
  let match = rows.find((r) => r.card_key === scanned);
  if (!match) {
    const partial = rows.filter((r) => r.card_key.length >= 6 && (scanned.includes(r.card_key) || (scanned.length >= 6 && r.card_key.includes(scanned))));
    if (partial.length === 1) match = partial[0];
  }
  if (!match) return c.json({ result: "unknown", code: data.code });
  if (match.status === "paid") return c.json({ result: "already", name: match.name, kind: match.kind, id: match.id });
  const table = match.kind === "guest" ? "guests" : "registrations";
  await query(`UPDATE ${table} SET status = 'paid', paid_at = now(), paid_method = 'scan' WHERE id = $1`, [match.id]);
  return c.json({ result: "paid", name: match.name, kind: match.kind, id: match.id });
});

app.patch("/api/admin/registrations/:id", async (c) => {
  const { data, error } = await parseBody(c, z.object({ status: z.enum(["pending", "paid"]) }));
  if (error) return bad(c, error);
  await query(
    `UPDATE registrations SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE NULL END,
       paid_method = CASE WHEN $1 = 'paid' THEN 'manual' ELSE NULL END WHERE id = $2`,
    [data.status, Number(c.req.param("id"))],
  );
  return c.json({ ok: true });
});

app.delete("/api/admin/registrations/:id", async (c) => {
  await query(`DELETE FROM registrations WHERE id = $1`, [Number(c.req.param("id"))]);
  return c.json({ ok: true });
});

app.patch("/api/admin/guests/:id", async (c) => {
  const { data, error } = await parseBody(c, z.object({ status: z.enum(["pending", "paid"]) }));
  if (error) return bad(c, error);
  await query(`UPDATE guests SET status = $1, paid_at = CASE WHEN $1 = 'paid' THEN now() ELSE NULL END WHERE id = $2`, [data.status, Number(c.req.param("id"))]);
  return c.json({ ok: true });
});

app.delete("/api/admin/guests/:id", async (c) => {
  await query(`DELETE FROM guests WHERE id = $1`, [Number(c.req.param("id"))]);
  return c.json({ ok: true });
});

// ---------- admin: records (last 14 days) ----------
app.get("/api/admin/records", async (c) => {
  await cleanupOldRecords();
  const { rows } = await query(`SELECT id FROM sessions WHERE date BETWEEN current_date - 14 AND current_date ORDER BY date DESC, start_time DESC`);
  const sessions = [];
  for (const row of rows) sessions.push(await sessionDetail(row.id));
  return c.json({ sessions });
});

// ---------- admin: players ----------
app.get("/api/admin/players", async (c) => {
  const { rows } = await query(
    `SELECT p.*,
       (SELECT count(*) FROM registrations r WHERE r.player_id = p.id) AS session_count,
       (SELECT max(r.created_at) FROM registrations r WHERE r.player_id = p.id) AS last_active
     FROM players p ORDER BY p.created_at DESC`,
  );
  return c.json({ players: rows.map((r) => ({ ...mapPlayer(r), sessionCount: Number(r.session_count), lastActive: r.last_active })) });
});

const adminPlayerSchema = z.object({ email: emailSchema, phone: phoneSchema, name: nameSchema, level: levelSchema });

app.post("/api/admin/players", async (c) => {
  const { data, error } = await parseBody(c, adminPlayerSchema);
  if (error) return bad(c, error);
  try {
    const row = (await query(
      `INSERT INTO players (email, phone, name, level) VALUES ($1,$2,$3,$4) RETURNING *`,
      [data.email, data.phone, data.name, data.level],
    )).rows[0];
    return c.json({ player: mapPlayer(row) });
  } catch (e) {
    if (e.code === "23505") return bad(c, "A player with this email already exists.", 409);
    throw e;
  }
});

app.patch("/api/admin/players/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, z.object({
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    name: nameSchema.optional(),
    level: levelSchema.optional(),
    blocked: z.boolean().optional(),
  }));
  if (error) return bad(c, error);
  const columns = { email: "email", phone: "phone", name: "name", level: "level", blocked: "blocked" };
  const sets = [], values = [];
  for (const [k, col] of Object.entries(columns)) {
    if (data[k] !== undefined) { values.push(data[k]); sets.push(`${col} = $${values.length}`); }
  }
  if (!sets.length) return bad(c, "Nothing to update.");
  values.push(id);
  try {
    const { rows } = await query(`UPDATE players SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    if (!rows[0]) return bad(c, "Player not found.", 404);
    if (data.blocked) await query(`DELETE FROM player_sessions WHERE player_id = $1`, [id]);
    return c.json({ player: mapPlayer(rows[0]) });
  } catch (e) {
    if (e.code === "23505") return bad(c, "Another player already uses this email.", 409);
    throw e;
  }
});

app.delete("/api/admin/players/:id", async (c) => {
  const id = Number(c.req.param("id"));
  await query(`DELETE FROM players WHERE id = $1`, [id]);
  return c.json({ ok: true });
});

// ---------- admin: tournaments ----------
const tournamentFields = z.object({
  name: z.string().trim().min(1, "enter a name").max(120),
  startsOn: isoDate,
  startTime: time.optional().nullable(),
  venue: z.string().trim().min(1, "enter a venue").max(120),
  description: z.string().trim().max(500).optional().nullable(),
});

app.get("/api/admin/tournaments", async (c) => {
  const { rows } = await query(
    `SELECT t.*, (SELECT count(*) FROM tournament_registrations r
                   JOIN tournament_categories c ON c.id = r.category_id
                   WHERE c.tournament_id = t.id) AS entry_count
     FROM tournaments t WHERE starts_on >= current_date - 30 ORDER BY starts_on DESC`,
  );
  return c.json({ tournaments: rows.map((r) => ({ ...mapTournament(r), entryCount: Number(r.entry_count) })) });
});

app.post("/api/admin/tournaments", async (c) => {
  const { data, error } = await parseBody(c, tournamentFields);
  if (error) return bad(c, error);
  const t = (await query(
    `INSERT INTO tournaments (name, starts_on, start_time, venue, description) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.name, data.startsOn, data.startTime || null, data.venue, data.description || null],
  )).rows[0];
  return c.json({ tournament: mapTournament(t) });
});

app.get("/api/admin/tournaments/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const detail = await tournamentWithCategories(id, { withPlayers: true });
  if (!detail) return bad(c, "Tournament not found.", 404);
  const regs = (await query(
    `SELECT r.*, c.format, c.level, p1.name AS player_name,
       COALESCE(p2.name, r.partner_name) AS partner_display
     FROM tournament_registrations r
     JOIN tournament_categories c ON c.id = r.category_id
     JOIN players p1 ON p1.id = r.player_id
     LEFT JOIN players p2 ON p2.id = r.partner_id
     WHERE c.tournament_id = $1
     ORDER BY c.level, c.format, r.created_at`,
    [id],
  )).rows.map((r) => ({
    id: r.id,
    categoryId: r.category_id,
    format: r.format,
    level: r.level,
    playerId: r.player_id,
    playerName: r.player_name,
    partnerId: r.partner_id,
    partnerName: r.partner_display,
    partnerRegistered: r.partner_id != null,
    createdAt: r.created_at,
  }));
  return c.json({ tournament: detail, registrations: regs });
});

app.patch("/api/admin/tournaments/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, z.object({
    name: tournamentFields.shape.name.optional(),
    startsOn: isoDate.optional(),
    startTime: time.optional().nullable(),
    venue: tournamentFields.shape.venue.optional(),
    description: tournamentFields.shape.description,
    status: z.enum(["draft", "open", "closed", "completed"]).optional(),
  }));
  if (error) return bad(c, error);
  const columns = { name: "name", startsOn: "starts_on", startTime: "start_time", venue: "venue", description: "description", status: "status" };
  const sets = [], values = [];
  for (const [k, col] of Object.entries(columns)) {
    if (data[k] !== undefined) {
      values.push(k === "description" || k === "startTime" ? (data[k] || null) : data[k]);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (!sets.length) return bad(c, "Nothing to update.");
  values.push(id);
  const { rows } = await query(`UPDATE tournaments SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
  if (!rows[0]) return bad(c, "Tournament not found.", 404);
  return c.json({ tournament: mapTournament(rows[0]) });
});

app.delete("/api/admin/tournaments/:id", async (c) => {
  await query(`DELETE FROM tournaments WHERE id = $1`, [Number(c.req.param("id"))]);
  return c.json({ ok: true });
});

const categoryFields = z.object({
  format: z.enum(FORMATS),
  level: z.enum(LEVELS),
  isOpen: z.boolean().default(true),
  maxEntries: z.number().int().positive().max(500).optional().nullable(),
});

app.post("/api/admin/tournaments/:id/categories", async (c) => {
  const tournamentId = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, categoryFields);
  if (error) return bad(c, error);
  try {
    const row = (await query(
      `INSERT INTO tournament_categories (tournament_id, format, level, is_open, max_entries)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tournamentId, data.format, data.level, data.isOpen, data.maxEntries || null],
    )).rows[0];
    return c.json({ category: { id: row.id, format: row.format, level: row.level, isOpen: row.is_open, maxEntries: row.max_entries, entryCount: 0 } });
  } catch (e) {
    if (e.code === "23505") return bad(c, "That format + level is already added.", 409);
    throw e;
  }
});

app.patch("/api/admin/tournaments/categories/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, z.object({
    isOpen: z.boolean().optional(),
    maxEntries: z.number().int().positive().max(500).nullable().optional(),
    format: z.enum(FORMATS).optional(),
    level: z.enum(LEVELS).optional(),
  }));
  if (error) return bad(c, error);
  const columns = { isOpen: "is_open", maxEntries: "max_entries", format: "format", level: "level" };
  const sets = [], values = [];
  for (const [k, col] of Object.entries(columns)) {
    if (data[k] !== undefined) { values.push(data[k]); sets.push(`${col} = $${values.length}`); }
  }
  if (!sets.length) return bad(c, "Nothing to update.");
  values.push(id);
  try {
    const { rows } = await query(`UPDATE tournament_categories SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
    if (!rows[0]) return bad(c, "Category not found.", 404);
    return c.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return bad(c, "Another category already uses that format + level.", 409);
    throw e;
  }
});

app.delete("/api/admin/tournaments/categories/:id", async (c) => {
  await query(`DELETE FROM tournament_categories WHERE id = $1`, [Number(c.req.param("id"))]);
  return c.json({ ok: true });
});

app.patch("/api/admin/tournaments/registrations/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, z.object({
    categoryId: z.number().int().optional(),
    playerId: z.number().int().optional(),
    partnerId: z.number().int().nullable().optional(),
    partnerName: partnerNameSchema.nullable().optional(),
  }));
  if (error) return bad(c, error);
  if (data.partnerId != null && data.partnerName) return bad(c, "Pick an existing player or type a name — not both.");
  try {
    const result = await tx(async (client) => {
      const reg = (await client.query(`SELECT * FROM tournament_registrations WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!reg) return { error: "Registration not found.", status: 404 };
      const nextCat = data.categoryId ?? reg.category_id;
      const nextPlayer = data.playerId ?? reg.player_id;
      const partnerTouched = data.partnerId !== undefined || data.partnerName !== undefined;
      const nextPartnerId = partnerTouched ? (data.partnerId ?? null) : reg.partner_id;
      const nextPartnerName = partnerTouched
        ? (nextPartnerId != null ? null : (data.partnerName?.trim() || null))
        : reg.partner_name;
      if (nextPartnerId === nextPlayer && nextPartnerId != null) return { error: "Player and partner must differ.", status: 400 };
      const cat = (await client.query(`SELECT format FROM tournament_categories WHERE id = $1`, [nextCat])).rows[0];
      if (!cat) return { error: "Target category not found.", status: 404 };
      const hasPartner = nextPartnerId != null || (nextPartnerName && nextPartnerName.trim());
      if (needsPartner(cat.format) && !hasPartner) return { error: "This category needs a partner.", status: 400 };
      if (!needsPartner(cat.format) && hasPartner) return { error: "Singles has no partner.", status: 400 };
      const clash = (await client.query(
        `SELECT id FROM tournament_registrations
         WHERE category_id = $1 AND id <> $2 AND (
           player_id = $3 OR partner_id = $3
           ${nextPartnerId ? "OR player_id = $4 OR partner_id = $4" : ""}
         )`,
        nextPartnerId ? [nextCat, id, nextPlayer, nextPartnerId] : [nextCat, id, nextPlayer],
      )).rows[0];
      if (clash) return { error: "Player or partner is already in that category.", status: 409 };
      await client.query(
        `UPDATE tournament_registrations SET category_id = $1, player_id = $2, partner_id = $3, partner_name = $4 WHERE id = $5`,
        [nextCat, nextPlayer, nextPartnerId, nextPartnerName, id],
      );
      return { ok: true };
    });
    if (result.error) return bad(c, result.error, result.status);
    return c.json({ ok: true });
  } catch (e) {
    if (e.code === "23505") return bad(c, "Duplicate registration for that category.", 409);
    throw e;
  }
});

app.delete("/api/admin/tournaments/registrations/:id", async (c) => {
  await query(`DELETE FROM tournament_registrations WHERE id = $1`, [Number(c.req.param("id"))]);
  return c.json({ ok: true });
});

// ---------- admin: storage / retention ----------
app.get("/api/admin/storage", async (c) => {
  const stats = await storageStats();
  return c.json(stats);
});

app.post("/api/admin/storage/cleanup", async (c) => {
  const removed = await cleanupOldRecords();
  return c.json({ removed });
});

// ---------- admin: team ----------
app.get("/api/admin/admins", async (c) => {
  const { rows } = await query(`SELECT id, email, approved, created_at FROM admins ORDER BY created_at`);
  return c.json({ admins: rows, me: c.get("admin").id });
});

app.patch("/api/admin/admins/:id", async (c) => {
  const { data, error } = await parseBody(c, z.object({ approved: z.boolean() }));
  if (error) return bad(c, error);
  const id = Number(c.req.param("id"));
  if (id === c.get("admin").id && !data.approved) return bad(c, "You can't remove your own access.");
  await query(`UPDATE admins SET approved = $1 WHERE id = $2`, [data.approved, id]);
  if (!data.approved) await query(`DELETE FROM admin_sessions WHERE admin_id = $1`, [id]);
  return c.json({ ok: true });
});

app.delete("/api/admin/admins/:id", async (c) => {
  const id = Number(c.req.param("id"));
  if (id === c.get("admin").id) return bad(c, "You can't delete your own account.");
  await query(`DELETE FROM admins WHERE id = $1`, [id]);
  return c.json({ ok: true });
});

app.notFound((c) => (c.req.path.startsWith("/api/") ? bad(c, "Not found", 404) : c.text("Not found", 404)));
app.onError((err, c) => {
  console.error(err);
  return bad(c, "Something went wrong on our side. Please try again.", 500);
});

// ---------- SEO + static frontend ----------
app.get("/robots.txt", (c) => c.text(robotsTxt(), 200, { "Cache-Control": "public, max-age=3600" }));
app.get("/sitemap.xml", async (c) => c.body(await sitemapXml(), 200, { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" }));

if (existsSync("./dist/index.html")) {
  const template = await readFile("./dist/index.html", "utf8");
  app.use("/assets/*", serveStatic({ root: "./dist", onFound: (_p, c) => c.header("Cache-Control", "public, max-age=31536000, immutable") }));
  // Files with an extension (icons, images, manifest) come straight from dist/.
  app.use("*", async (c, next) => (/\.[a-z0-9]+$/i.test(c.req.path) && c.req.path !== "/index.html" ? serveStatic({ root: "./dist", onFound: (_p, cc) => cc.header("Cache-Control", "public, max-age=86400") })(c, next) : next()));
  // Every page route gets server-rendered <head> tags (and crawlable content on the homepage).
  app.get("*", async (c) => {
    if (c.req.path.startsWith("/api/")) return bad(c, "Not found", 404);
    const { html, status, index } = await renderPage(template, c.req.path);
    c.header("Cache-Control", "no-cache");
    if (!index) c.header("X-Robots-Tag", "noindex, nofollow");
    return c.html(html, status);
  });
}

// ---------- boot ----------
await migrate();
await cleanupOldRecords();
await autoClosePolls();
setInterval(() => cleanupOldRecords().catch((e) => console.error("cleanup failed", e)), 60 * 60 * 1000);
setInterval(() => autoClosePolls().catch((e) => console.error("auto-close failed", e)), 5 * 60 * 1000);

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => console.log(`Friends Club running on :${port}`));
