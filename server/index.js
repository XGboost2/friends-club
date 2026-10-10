import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { createClerkClient, verifyToken } from "@clerk/backend";
import { CLUB_TZ, query, tx, migrate, cleanupOldRecords, storageStats } from "./db.js";
import { renderPage, robotsTxt, sitemapXml } from "./seo.js";

const app = new Hono();
const isProd = process.env.NODE_ENV === "production";
const COOKIE = "fc_admin";
const SESSION_DAYS = 30;
const CANCEL_LOCK_HOURS = 25;
const AUTO_CLOSE_HOURS = 24;

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;
if (!CLERK_SECRET_KEY) {
  console.error("CLERK_SECRET_KEY is not set. Add it to your .env — see .env.example.");
  process.exit(1);
}
const clerkClient = createClerkClient({ secretKey: CLERK_SECRET_KEY });

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
    reopenUntil: row.reopen_until,
    playerCount: Number(row.player_count ?? 0),
    guestCount: Number(row.guest_count ?? 0),
    total: Number(row.player_count ?? 0) + Number(row.guest_count ?? 0),
    players: row.players ?? [],
  };
}

function mapPlayer(row) {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    name: row.name,
    level: row.level,
    multisportCardNumber: row.multisport_card_number,
    multisportHolderName: row.multisport_holder_name,
    blocked: row.blocked,
    createdAt: row.created_at,
  };
}

/**
 * Close voting when:
 *   - admin's reopen window has expired, OR
 *   - no reopen window is set AND session starts within AUTO_CLOSE_HOURS.
 * Safe to call frequently.
 */
async function autoClosePolls() {
  await query(
    `UPDATE sessions SET status = 'closed', reopen_until = NULL
     WHERE status = 'open'
       AND (
         (reopen_until IS NOT NULL AND reopen_until <= now())
         OR (reopen_until IS NULL
             AND ((date::text || ' ' || start_time)::timestamp AT TIME ZONE '${CLUB_TZ}') <= now() + interval '${AUTO_CLOSE_HOURS} hours')
       )`,
  );
}

const SESSION_STATS_SQL = `
  SELECT s.*,
    ((s.date::text || ' ' || s.start_time)::timestamp AT TIME ZONE '${CLUB_TZ}') AS start_at,
    (SELECT count(*) FROM registrations r WHERE r.session_id = s.id) AS player_count,
    (SELECT count(*) FROM guests g JOIN registrations r ON r.id = g.registration_id WHERE r.session_id = s.id) AS guest_count,
    COALESCE((SELECT json_agg(r.player_name ORDER BY r.created_at) FROM registrations r WHERE r.session_id = s.id), '[]'::json) AS players
  FROM sessions s`;

const clientIp = (c) => c.req.header("x-forwarded-for")?.split(",")[0].trim() || c.env?.incoming?.socket?.remoteAddress || "local";

// ---------- player auth (Clerk-backed) ----------

const emailSchema = z.email("enter a valid email").trim().toLowerCase();
const phoneSchema = z.string().trim().min(6, "enter a valid phone number").max(30);
const levelSchema = z.enum(["beginner", "intermediate", "advanced"]);
const nameSchema = z.string().trim().min(1, "enter your name").max(60);

async function verifyClerkBearer(c) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    return await verifyToken(token, { secretKey: CLERK_SECRET_KEY });
  } catch (e) {
    console.warn("Clerk token verification failed:", e?.message || e);
    return null;
  }
}

/**
 * Resolve the player row backing the current Clerk session. On first access we
 * link to an existing row by email (manual-admin-created players) or provision
 * a new one from Clerk's profile data. Phone/level stay NULL until the player
 * completes their profile.
 */
async function currentPlayer(c) {
  const payload = await verifyClerkBearer(c);
  if (!payload?.sub) return null;
  const clerkUserId = payload.sub;

  const existing = (await query(`SELECT * FROM players WHERE clerk_user_id = $1`, [clerkUserId])).rows[0];
  if (existing) return existing.blocked ? null : existing;

  // First access with this Clerk user — fetch profile and link or create.
  let clerkUser;
  try {
    clerkUser = await clerkClient.users.getUser(clerkUserId);
  } catch (e) {
    console.warn("Clerk user fetch failed:", e?.message || e);
    return null;
  }
  const primaryEmail = clerkUser.emailAddresses?.find((e) => e.id === clerkUser.primaryEmailAddressId)?.emailAddress
    || clerkUser.emailAddresses?.[0]?.emailAddress;
  if (!primaryEmail) return null;
  const email = primaryEmail.toLowerCase();
  const displayName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ").trim()
    || clerkUser.username
    || email.split("@")[0];

  // Link an existing player row by email (e.g. one an admin created manually).
  const byEmail = (await query(`SELECT * FROM players WHERE email = $1`, [email])).rows[0];
  if (byEmail) {
    if (byEmail.blocked) return null;
    const linked = (await query(
      `UPDATE players SET clerk_user_id = $1 WHERE id = $2 AND clerk_user_id IS NULL RETURNING *`,
      [clerkUserId, byEmail.id],
    )).rows[0];
    return linked || null;
  }

  // Create a shell row — profile completion (phone/level) happens on the Profile page.
  try {
    const created = (await query(
      `INSERT INTO players (clerk_user_id, email, name) VALUES ($1, $2, $3) RETURNING *`,
      [clerkUserId, email, displayName.slice(0, 60)],
    )).rows[0];
    return created;
  } catch (e) {
    if (e.code === "23505") {
      // Race: another request linked/created the row first.
      return (await query(`SELECT * FROM players WHERE clerk_user_id = $1`, [clerkUserId])).rows[0] || null;
    }
    throw e;
  }
}

app.get("/api/me", async (c) => {
  const player = await currentPlayer(c);
  return c.json({ player: player ? mapPlayer(player) : null });
});

app.patch("/api/me", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in.", 401);
  const { data, error } = await parseBody(c, z.object({
    name: nameSchema.optional(),
    phone: phoneSchema.optional(),
    level: levelSchema.optional(),
    multisportCardNumber: z.string().trim().max(40).nullable().optional(),
    multisportHolderName: z.string().trim().max(80).nullable().optional(),
  }));
  if (error) return bad(c, error);
  const columns = { name: "name", phone: "phone", level: "level", multisportCardNumber: "multisport_card_number", multisportHolderName: "multisport_holder_name" };
  const sets = [], values = [];
  for (const [k, col] of Object.entries(columns)) {
    if (data[k] !== undefined) { values.push(data[k]); sets.push(`${col} = $${values.length}`); }
  }
  if (!sets.length) return bad(c, "Nothing to update.");
  values.push(player.id);
  const { rows } = await query(`UPDATE players SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING *`, values);
  return c.json({ player: mapPlayer(rows[0]) });
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
  // Legacy fields kept so cached browser bundles from the pre-profile-card era keep working.
  // On first use, we persist them to the player's profile so later joins read from there.
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
  // Player's Multisport card lives on their profile. Fall back to the request body
  // (legacy clients) and persist to the profile on first use.
  let playerCardNumber = "";
  let playerHolderName = "";
  let persistCard = false;
  if (data.usesMultisport) {
    playerCardNumber = (player.multisport_card_number || "").trim();
    playerHolderName = (player.multisport_holder_name || "").trim();
    if (!playerCardNumber && data.cardNumber) {
      playerCardNumber = data.cardNumber.trim();
      playerHolderName = (data.holderName || "").trim();
      persistCard = true;
    }
    if (cardKey(playerCardNumber).length < 6) return bad(c, "Add your Multisport card number in your profile first.");
    if (!playerHolderName) return bad(c, "Add the name on your Multisport card in your profile first.");
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
  if (data.usesMultisport && !addCard(cardKey(playerCardNumber))) return bad(c, "The same Multisport card can't be used twice in one booking.");
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
      const reopenActive = s.reopen_until && new Date(s.reopen_until).getTime() > Date.now();
      if (timing.closing_soon && !reopenActive) {
        // Race: someone joined between auto-close sweeps. Persist the close and reject.
        await client.query(`UPDATE sessions SET status = 'closed' WHERE id = $1`, [id]);
        return { status: 409, error: `Voting closes ${AUTO_CLOSE_HOURS} hours before the session.` };
      }
      if (reopenActive && new Date(s.reopen_until) <= new Date()) {
        await client.query(`UPDATE sessions SET status = 'closed', reopen_until = NULL WHERE id = $1`, [id]);
        return { status: 409, error: "The reopen window just ended." };
      }
      const existing = (await client.query(`SELECT id FROM registrations WHERE session_id = $1 AND player_id = $2`, [id, player.id])).rows[0];
      if (existing) return { status: 409, error: "You're already in this session." };
      // Card collision check: block if any card in this booking is already booked for this session.
      const cardsToCheck = [];
      if (data.usesMultisport) cardsToCheck.push(cardKey(playerCardNumber));
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
          data.usesMultisport ? playerCardNumber : null,
          data.usesMultisport ? cardKey(playerCardNumber) : null,
          data.usesMultisport ? playerHolderName : null],
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
    if (persistCard) {
      await query(
        `UPDATE players SET multisport_card_number = $1, multisport_holder_name = $2
           WHERE id = $3 AND multisport_card_number IS NULL`,
        [playerCardNumber, playerHolderName, player.id],
      );
    }
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
const FORMATS = ["mens_singles", "womens_singles", "mens_doubles", "womens_doubles", "mixed"];
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

function needsPartner(format) { return !format.endsWith("singles"); }

async function tournamentWithCategories(tournamentId, opts = {}) {
  const t = (await query(`SELECT * FROM tournaments WHERE id = $1`, [tournamentId])).rows[0];
  if (!t) return null;
  const cats = (await query(
    `SELECT c.*,
       (SELECT count(*) FROM tournament_registrations r WHERE r.category_id = c.id) AS entry_count,
       (SELECT count(*) FROM tournament_matches m WHERE m.category_id = c.id) AS match_count
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
    structure: c.structure,
    groupSize: c.group_size,
    advanceCount: c.advance_count,
    hasFixtures: Number(c.match_count) > 0,
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

function mapMatchRow(r) {
  const entry = (idField, nameField, partnerField) => (r[idField] == null ? null : { id: r[idField], playerName: r[nameField], partnerName: r[partnerField] });
  return {
    id: r.id,
    categoryId: r.category_id,
    stage: r.stage,
    groupId: r.group_id,
    groupName: r.group_name ?? null,
    roundNumber: r.round_number,
    slot: r.slot,
    entryA: entry("entry_a_id", "a_player", "a_partner"),
    entryB: entry("entry_b_id", "b_player", "b_partner"),
    winnerEntryId: r.winner_entry_id,
    set1: r.set1_a != null && r.set1_b != null ? [r.set1_a, r.set1_b] : null,
    set2: r.set2_a != null && r.set2_b != null ? [r.set2_a, r.set2_b] : null,
    set3: r.set3_a != null && r.set3_b != null ? [r.set3_a, r.set3_b] : null,
    court: r.court,
    scheduledAt: r.scheduled_at,
    status: r.status,
    reportedBy: r.reported_by,
    reportedAt: r.reported_at,
    confirmedAt: r.confirmed_at,
  };
}

const MATCH_LIST_SQL = `
  SELECT m.*, tg.name AS group_name,
    pa.name AS a_player, COALESCE(paa.name, ra.partner_name) AS a_partner,
    pb.name AS b_player, COALESCE(pbb.name, rb.partner_name) AS b_partner
  FROM tournament_matches m
  LEFT JOIN tournament_groups tg ON tg.id = m.group_id
  LEFT JOIN tournament_registrations ra ON ra.id = m.entry_a_id
  LEFT JOIN players pa ON pa.id = ra.player_id
  LEFT JOIN players paa ON paa.id = ra.partner_id
  LEFT JOIN tournament_registrations rb ON rb.id = m.entry_b_id
  LEFT JOIN players pb ON pb.id = rb.player_id
  LEFT JOIN players pbb ON pbb.id = rb.partner_id`;

async function scheduleFor(tournamentId, viewerPlayerId = null) {
  const cats = (await query(
    `SELECT * FROM tournament_categories WHERE tournament_id = $1 ORDER BY level, format`,
    [tournamentId],
  )).rows;
  const perCat = [];
  for (const c of cats) {
    const groupsRows = (await query(
      `SELECT g.id, g.name, g.position FROM tournament_groups g WHERE g.category_id = $1 ORDER BY g.position`,
      [c.id],
    )).rows;
    const groups = [];
    for (const g of groupsRows) {
      const { entries } = await groupStandings({ query }, g.id);
      // Qualifying badge — top advance_count are 'qualified'. Below that we call it 'in-contention' until
      // all their group matches are confirmed (lazy: mark 'eliminated' only if they've played everyone).
      const groupSize = entries.length;
      const groupMatchesPerEntry = groupSize - 1;
      entries.forEach((e, i) => {
        if (i < c.advance_count) e.qualifying = "qualified";
        else if (e.played >= groupMatchesPerEntry) e.qualifying = "eliminated";
        else e.qualifying = "in-contention";
      });
      groups.push({ id: g.id, name: g.name, position: g.position, entries });
    }
    const matches = (await query(`${MATCH_LIST_SQL} WHERE m.category_id = $1 ORDER BY m.stage, m.round_number, m.slot, m.id`, [c.id])).rows.map(mapMatchRow);
    perCat.push({
      category: {
        id: c.id, format: c.format, level: c.level, isOpen: c.is_open,
        maxEntries: c.max_entries, entryCount: 0,
        structure: c.structure, groupSize: c.group_size, advanceCount: c.advance_count,
        hasFixtures: matches.length > 0,
      },
      groups,
      matches,
    });
  }
  return perCat;
}

app.get("/api/tournaments/:id/schedule", async (c) => {
  const id = Number(c.req.param("id"));
  const t = (await query(`SELECT * FROM tournaments WHERE id = $1`, [id])).rows[0];
  if (!t) return bad(c, "Tournament not found.", 404);
  // Draft tournaments are visible via schedule too so admins can prep fixtures before publishing.
  // Players who guess a draft ID would see the fixtures but there's nothing sensitive here.
  const list = await scheduleFor(id);
  return c.json({ tournament: mapTournament(t), categories: list });
});

// Player-side report + retract
const reportSchema = scoreSchemaLazy();
function scoreSchemaLazy() {
  // Defined lazily so we can reference the same pair schema without hoisting issues.
  const pair = z.tuple([z.number().int().min(0).max(60), z.number().int().min(0).max(60)]);
  return z.object({
    set1: pair,
    set2: pair,
    set3: pair.nullable().optional(),
  });
}

app.post("/api/tournaments/matches/:id/report", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in to report a result.", 401);
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, reportSchema);
  if (error) return bad(c, error);
  const result = await tx(async (client) => {
    const m = (await client.query(`SELECT * FROM tournament_matches WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!m) return { error: "Match not found.", status: 404 };
    if (m.status === "confirmed") return { error: "This match is already confirmed.", status: 409 };
    if (!m.entry_a_id || !m.entry_b_id) return { error: "Both sides must be assigned first.", status: 400 };
    // Either registered player in the match can report — owner or partner. Off-app partners
    // have no account so they can't hit this endpoint; their teammate handles it.
    const owns = (await client.query(
      `SELECT 1 FROM tournament_registrations
       WHERE (id = $1 OR id = $2) AND (player_id = $3 OR partner_id = $3)`,
      [m.entry_a_id, m.entry_b_id, player.id],
    )).rows[0];
    if (!owns) return { error: "Only the players in this match can report a result.", status: 403 };
    const values = {
      set1_a: data.set1[0], set1_b: data.set1[1],
      set2_a: data.set2[0], set2_b: data.set2[1],
      set3_a: data.set3 ? data.set3[0] : null,
      set3_b: data.set3 ? data.set3[1] : null,
    };
    const winner = scoreWinner({ ...m, ...values }, m.entry_a_id, m.entry_b_id);
    if (!winner) return { error: "Scores don't determine a winner. Enter set 3 if needed.", status: 400 };
    await client.query(
      `UPDATE tournament_matches
         SET set1_a = $1, set1_b = $2, set2_a = $3, set2_b = $4, set3_a = $5, set3_b = $6,
             status = 'reported', reported_by = $7, reported_at = now()
       WHERE id = $8`,
      [values.set1_a, values.set1_b, values.set2_a, values.set2_b, values.set3_a, values.set3_b, player.id, id],
    );
    return { ok: true };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json({ ok: true });
});

app.delete("/api/tournaments/matches/:id/report", async (c) => {
  const player = await currentPlayer(c);
  if (!player) return bad(c, "Please sign in.", 401);
  const id = Number(c.req.param("id"));
  const result = await tx(async (client) => {
    const m = (await client.query(`SELECT * FROM tournament_matches WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!m) return { error: "Match not found.", status: 404 };
    if (m.status !== "reported") return { error: "Nothing to retract.", status: 409 };
    if (m.reported_by !== player.id) return { error: "Only the reporter can retract.", status: 403 };
    await client.query(
      `UPDATE tournament_matches
         SET status = 'pending', reported_by = NULL, reported_at = NULL,
             set1_a = NULL, set1_b = NULL, set2_a = NULL, set2_b = NULL, set3_a = NULL, set3_b = NULL
       WHERE id = $1`,
      [id],
    );
    return { ok: true };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json({ ok: true });
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

const credentials = z.object({ email: z.email("enter a valid email").trim().toLowerCase(), password: z.string().min(8, "use at least 8 characters").max(200) });

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
    // Admin-driven reopen window. Minutes from now; wins over the 24h auto-close rule.
    reopenMinutes: z.number().int().min(1).max(24 * 60).optional(),
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
  // Reopen window — only valid when the request also sets status='open' (or the row is already open).
  if (data.reopenMinutes != null) {
    sets.push(`reopen_until = now() + interval '${data.reopenMinutes} minutes'`);
  } else if (data.status === "closed") {
    sets.push(`reopen_until = NULL`);
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
    // Blocking: currentPlayer() returns null for blocked rows, so new API calls fail with 401.
    // Clerk's own session cookie remains until it expires or the user signs out.
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

const STRUCTURES = ["group", "ko", "group_ko"];
const categoryFields = z.object({
  format: z.enum(FORMATS),
  level: z.enum(LEVELS),
  isOpen: z.boolean().default(true),
  maxEntries: z.number().int().positive().max(500).optional().nullable(),
  structure: z.enum(STRUCTURES).default("group_ko"),
  groupSize: z.number().int().min(2).max(8).default(4),
  advanceCount: z.number().int().min(1).max(8).default(2),
});

app.post("/api/admin/tournaments/:id/categories", async (c) => {
  const tournamentId = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, categoryFields);
  if (error) return bad(c, error);
  try {
    const row = (await query(
      `INSERT INTO tournament_categories (tournament_id, format, level, is_open, max_entries, structure, group_size, advance_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [tournamentId, data.format, data.level, data.isOpen, data.maxEntries || null, data.structure, data.groupSize, data.advanceCount],
    )).rows[0];
    return c.json({ category: {
      id: row.id, format: row.format, level: row.level, isOpen: row.is_open,
      maxEntries: row.max_entries, entryCount: 0,
      structure: row.structure, groupSize: row.group_size, advanceCount: row.advance_count,
    } });
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
    structure: z.enum(STRUCTURES).optional(),
    groupSize: z.number().int().min(2).max(8).optional(),
    advanceCount: z.number().int().min(1).max(8).optional(),
  }));
  if (error) return bad(c, error);
  // Locking rule: structure/groupSize/advanceCount can't change once fixtures exist.
  if (data.structure !== undefined || data.groupSize !== undefined || data.advanceCount !== undefined) {
    const has = Number((await query(`SELECT count(*) AS n FROM tournament_matches WHERE category_id = $1`, [id])).rows[0].n);
    if (has > 0) return bad(c, "Reset fixtures before changing structure or group settings.", 409);
  }
  const columns = { isOpen: "is_open", maxEntries: "max_entries", format: "format", level: "level", structure: "structure", groupSize: "group_size", advanceCount: "advance_count" };
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

// ---------- fixture generation helpers ----------
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Distribute N ids into G groups, snake-style. Balances registration order. */
function snakeDistribute(ids, groupCount) {
  const groups = Array.from({ length: groupCount }, () => []);
  let dir = 1, idx = 0;
  for (const id of ids) {
    groups[idx].push(id);
    idx += dir;
    if (idx === groupCount) { idx = groupCount - 1; dir = -1; }
    else if (idx < 0) { idx = 0; dir = 1; }
  }
  return groups;
}

/** Berger-style round-robin pairs for a group of size k (1-indexed positions). */
function roundRobinPairs(k) {
  const positions = Array.from({ length: k }, (_, i) => i + 1);
  const pairs = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      pairs.push([positions[i], positions[j]]);
    }
  }
  return pairs;
}

const nextPow2 = (n) => { let p = 1; while (p < n) p <<= 1; return Math.max(2, p); };
const STAGE_ORDER = ["final", "semi", "quarter", "r16", "r32"];
function stageFor(round, totalRounds) {
  const dist = totalRounds - round; // 0 = final round
  return STAGE_ORDER[dist] || "group";
}

/** Standard tournament seeding order for bracket size n (must be power of 2). */
function seedOrder(size) {
  let order = [1, 2];
  while (order.length < size) {
    const doubled = order.length * 2;
    const next = [];
    for (const s of order) {
      next.push(s);
      next.push(doubled + 1 - s);
    }
    order = next;
  }
  return order;
}

// ---------- fixture generation endpoints ----------
async function categoryOrDie(client, id) {
  const row = (await client.query(`SELECT * FROM tournament_categories WHERE id = $1 FOR UPDATE`, [id])).rows[0];
  return row || null;
}

app.post("/api/admin/tournaments/categories/:id/reset", async (c) => {
  const id = Number(c.req.param("id"));
  await tx(async (client) => {
    await client.query(`DELETE FROM tournament_matches WHERE category_id = $1`, [id]);
    await client.query(`DELETE FROM tournament_groups WHERE category_id = $1`, [id]);
  });
  return c.json({ ok: true });
});

app.post("/api/admin/tournaments/categories/:id/generate-groups", async (c) => {
  const id = Number(c.req.param("id"));
  const result = await tx(async (client) => {
    const cat = await categoryOrDie(client, id);
    if (!cat) return { error: "Category not found.", status: 404 };
    if (cat.structure === "ko") return { error: "This category is knockout-only. Use Generate knockout instead.", status: 400 };
    const has = Number((await client.query(`SELECT count(*) AS n FROM tournament_matches WHERE category_id = $1 AND stage = 'group'`, [id])).rows[0].n);
    if (has > 0) return { error: "Group matches already exist. Reset first.", status: 409 };
    const entries = shuffleInPlace(
      (await client.query(`SELECT id FROM tournament_registrations WHERE category_id = $1`, [id])).rows.map((r) => r.id),
    );
    if (entries.length < 2) return { error: "Need at least 2 entries.", status: 400 };
    const groupCount = Math.max(1, Math.ceil(entries.length / cat.group_size));
    const buckets = snakeDistribute(entries, groupCount);
    // Wipe any lingering groups (shouldn't be any, but keep it idempotent).
    await client.query(`DELETE FROM tournament_groups WHERE category_id = $1`, [id]);
    for (let i = 0; i < buckets.length; i++) {
      const name = String.fromCharCode(65 + i); // A, B, C...
      const g = (await client.query(
        `INSERT INTO tournament_groups (category_id, name, position) VALUES ($1,$2,$3) RETURNING id`,
        [id, name, i],
      )).rows[0];
      const members = buckets[i];
      for (let s = 0; s < members.length; s++) {
        await client.query(
          `INSERT INTO tournament_group_entries (group_id, registration_id, seed) VALUES ($1,$2,$3)`,
          [g.id, members[s], s + 1],
        );
      }
      // Round-robin matches within this group.
      for (const [a, b] of roundRobinPairs(members.length)) {
        await client.query(
          `INSERT INTO tournament_matches (category_id, stage, group_id, entry_a_id, entry_b_id)
           VALUES ($1,'group',$2,$3,$4)`,
          [id, g.id, members[a - 1], members[b - 1]],
        );
      }
    }
    return { ok: true, groups: buckets.length };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json(result);
});

async function groupStandings(client, groupId) {
  const entries = (await client.query(
    `SELECT ge.registration_id, r.player_id, r.partner_id, r.partner_name,
            p.name AS player_name, COALESCE(p2.name, r.partner_name) AS partner_display
     FROM tournament_group_entries ge
     JOIN tournament_registrations r ON r.id = ge.registration_id
     JOIN players p ON p.id = r.player_id
     LEFT JOIN players p2 ON p2.id = r.partner_id
     WHERE ge.group_id = $1`,
    [groupId],
  )).rows;
  const matches = (await client.query(
    `SELECT * FROM tournament_matches WHERE group_id = $1 AND status = 'confirmed'`,
    [groupId],
  )).rows;
  const stats = new Map(entries.map((e) => [e.registration_id, {
    registrationId: e.registration_id,
    playerName: e.player_name,
    partnerName: e.partner_display,
    played: 0, wins: 0, losses: 0, setsWon: 0, setsLost: 0, pointsFor: 0, pointsAgainst: 0,
  }]));
  for (const m of matches) {
    const a = stats.get(m.entry_a_id), b = stats.get(m.entry_b_id);
    if (!a || !b) continue;
    const sets = [[m.set1_a, m.set1_b], [m.set2_a, m.set2_b], [m.set3_a, m.set3_b]].filter((s) => s[0] != null && s[1] != null);
    let setsA = 0, setsB = 0, pA = 0, pB = 0;
    for (const [sa, sb] of sets) {
      pA += sa; pB += sb;
      if (sa > sb) setsA++;
      else if (sb > sa) setsB++;
    }
    a.played++; b.played++;
    a.setsWon += setsA; a.setsLost += setsB;
    b.setsWon += setsB; b.setsLost += setsA;
    a.pointsFor += pA; a.pointsAgainst += pB;
    b.pointsFor += pB; b.pointsAgainst += pA;
    if (m.winner_entry_id === a.registrationId) { a.wins++; b.losses++; }
    else if (m.winner_entry_id === b.registrationId) { b.wins++; a.losses++; }
  }
  const ranked = [...stats.values()].sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    const xDiff = x.setsWon - x.setsLost, yDiff = y.setsWon - y.setsLost;
    if (yDiff !== xDiff) return yDiff - xDiff;
    const xPd = x.pointsFor - x.pointsAgainst, yPd = y.pointsFor - y.pointsAgainst;
    if (yPd !== xPd) return yPd - xPd;
    if (y.pointsFor !== x.pointsFor) return y.pointsFor - x.pointsFor;
    return x.playerName.localeCompare(y.playerName);
  });
  ranked.forEach((r, i) => (r.rank = i + 1));
  return { entries: ranked, matchesPlayed: matches.length };
}

app.post("/api/admin/tournaments/categories/:id/generate-knockout", async (c) => {
  const id = Number(c.req.param("id"));
  const result = await tx(async (client) => {
    const cat = await categoryOrDie(client, id);
    if (!cat) return { error: "Category not found.", status: 404 };
    let entries;
    if (cat.structure === "ko") {
      entries = shuffleInPlace(
        (await client.query(`SELECT id FROM tournament_registrations WHERE category_id = $1`, [id])).rows.map((r) => r.id),
      );
    } else {
      // group_ko: pick top advance_count from each group. Requires all group matches confirmed.
      const groups = (await client.query(
        `SELECT id FROM tournament_groups WHERE category_id = $1 ORDER BY position`,
        [id],
      )).rows;
      if (!groups.length) return { error: "Generate groups first.", status: 409 };
      const remaining = Number((await client.query(
        `SELECT count(*) AS n FROM tournament_matches WHERE category_id = $1 AND stage = 'group' AND status <> 'confirmed'`,
        [id],
      )).rows[0].n);
      if (remaining > 0) return { error: `${remaining} group match(es) still need to be confirmed.`, status: 409 };
      entries = [];
      const perGroup = [];
      for (const g of groups) {
        const { entries: standings } = await groupStandings(client, g.id);
        const top = standings.slice(0, cat.advance_count).map((s) => s.registrationId);
        perGroup.push(top);
      }
      // Cross-pair by rank so group-mates don't meet in the first round.
      const maxPerGroup = Math.max(...perGroup.map((g) => g.length));
      for (let rank = 0; rank < maxPerGroup; rank++) {
        for (let g = 0; g < perGroup.length; g++) {
          const id2 = perGroup[g][rank];
          if (id2) entries.push(id2);
        }
      }
    }
    if (entries.length < 2) return { error: "Need at least 2 entries to build a bracket.", status: 400 };
    // Wipe any existing knockout matches.
    await client.query(`DELETE FROM tournament_matches WHERE category_id = $1 AND stage <> 'group'`, [id]);
    const bracketSize = nextPow2(entries.length);
    if (bracketSize > 32) return { error: "Bracket too large (max 32 entries).", status: 400 };
    const order = seedOrder(bracketSize);
    // Fill by seed position; overflow past entries.length are byes (null).
    const slots = order.map((seedPos) => entries[seedPos - 1] ?? null);
    const totalRounds = Math.log2(bracketSize);
    // Create matches for round 1 (round_number = 1 furthest from final).
    // Actually we index rounds so that round=totalRounds is the final.
    // Rows correspond to bracket slots — pairs (0,1), (2,3), ...
    const roundOneMatches = [];
    for (let i = 0; i < bracketSize; i += 2) {
      const a = slots[i], b = slots[i + 1];
      const round = 1;
      const slot = i / 2;
      const stage = stageFor(round, totalRounds);
      let winner = null;
      // If one side is null (bye), the other side auto-advances.
      if (a && !b) winner = a;
      else if (!a && b) winner = b;
      const status = winner ? "confirmed" : "pending";
      const row = (await client.query(
        `INSERT INTO tournament_matches (category_id, stage, round_number, slot, entry_a_id, entry_b_id, winner_entry_id, status, confirmed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $8 = 'confirmed' THEN now() END) RETURNING id`,
        [id, stage, round, slot, a, b, winner, status],
      )).rows[0];
      roundOneMatches.push({ id: row.id, slot, winner });
    }
    // Create empty matches for subsequent rounds, filling entry slots with any auto-advanced byes.
    let previous = roundOneMatches;
    for (let round = 2; round <= totalRounds; round++) {
      const parents = [];
      for (let i = 0; i < previous.length; i += 2) {
        const parentSlot = Math.floor(previous[i].slot / 2);
        const stage = stageFor(round, totalRounds);
        const winnerA = previous[i].winner;
        const winnerB = previous[i + 1]?.winner ?? null;
        let winner = null;
        if (winnerA && !previous[i + 1]) winner = winnerA;
        const status = winner ? "confirmed" : "pending";
        const row = (await client.query(
          `INSERT INTO tournament_matches (category_id, stage, round_number, slot, entry_a_id, entry_b_id, winner_entry_id, status, confirmed_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CASE WHEN $8 = 'confirmed' THEN now() END) RETURNING id`,
          [id, stage, round, parentSlot, winnerA, winnerB, winner, status],
        )).rows[0];
        parents.push({ id: row.id, slot: parentSlot, winner });
      }
      previous = parents;
    }
    return { ok: true, matches: bracketSize - 1 };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json(result);
});

app.post("/api/admin/tournaments/groups/:id/swap", async (c) => {
  const groupId = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, z.object({ regA: z.number().int(), regB: z.number().int() }));
  if (error) return bad(c, error);
  const result = await tx(async (client) => {
    const a = (await client.query(`SELECT * FROM tournament_group_entries WHERE registration_id = $1`, [data.regA])).rows[0];
    const b = (await client.query(`SELECT * FROM tournament_group_entries WHERE registration_id = $1`, [data.regB])).rows[0];
    if (!a || !b) return { error: "One or both entries not found.", status: 404 };
    // Both must belong to the same category (via their groups).
    const g1 = (await client.query(`SELECT category_id FROM tournament_groups WHERE id = $1`, [a.group_id])).rows[0];
    const g2 = (await client.query(`SELECT category_id FROM tournament_groups WHERE id = $1`, [b.group_id])).rows[0];
    if (g1.category_id !== g2.category_id) return { error: "Entries belong to different categories.", status: 400 };
    // Refuse to swap once anyone has entered scores — swap wipes+rebuilds the round-robin.
    const played = Number((await client.query(
      `SELECT count(*) AS n FROM tournament_matches
       WHERE category_id = $1 AND stage = 'group' AND status <> 'pending'`,
      [g1.category_id],
    )).rows[0].n);
    if (played > 0) {
      return { error: "Can't swap once group matches have been reported or confirmed. Reset the category first.", status: 409 };
    }
    // Swap group_id (seed stays).
    await client.query(`UPDATE tournament_group_entries SET group_id = $1 WHERE registration_id = $2`, [b.group_id, data.regA]);
    await client.query(`UPDATE tournament_group_entries SET group_id = $1 WHERE registration_id = $2`, [a.group_id, data.regB]);
    // Wipe pending group matches for both affected groups and re-emit them.
    await client.query(
      `DELETE FROM tournament_matches WHERE category_id = $1 AND stage = 'group'`,
      [g1.category_id],
    );
    // Re-emit round-robin matches for both affected groups.
    for (const gid of [a.group_id, b.group_id]) {
      const members = (await client.query(
        `SELECT registration_id FROM tournament_group_entries WHERE group_id = $1 ORDER BY seed NULLS LAST, registration_id`,
        [gid],
      )).rows.map((r) => r.registration_id);
      for (const [x, y] of roundRobinPairs(members.length)) {
        await client.query(
          `INSERT INTO tournament_matches (category_id, stage, group_id, entry_a_id, entry_b_id)
           VALUES ($1,'group',$2,$3,$4)`,
          [g1.category_id, gid, members[x - 1], members[y - 1]],
        );
      }
    }
    return { ok: true };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json({ ok: true });
});

const matchScheduleSchema = z.object({
  court: z.string().trim().max(60).nullable().optional(),
  scheduledAt: z.string().datetime().nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});

app.patch("/api/admin/tournaments/matches/:id", async (c) => {
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, matchScheduleSchema);
  if (error) return bad(c, error);
  const columns = { court: "court", scheduledAt: "scheduled_at", notes: "notes" };
  const sets = [], values = [];
  for (const [k, col] of Object.entries(columns)) {
    if (data[k] !== undefined) { values.push(data[k] || null); sets.push(`${col} = $${values.length}`); }
  }
  if (!sets.length) return bad(c, "Nothing to update.");
  values.push(id);
  const { rows } = await query(`UPDATE tournament_matches SET ${sets.join(", ")} WHERE id = $${values.length} RETURNING id`, values);
  if (!rows[0]) return bad(c, "Match not found.", 404);
  return c.json({ ok: true });
});

// ---- score entry + confirmation ----
const setPairSchema = z.tuple([z.number().int().min(0).max(60), z.number().int().min(0).max(60)]);
const scoreSchema = z.object({
  set1: setPairSchema,
  set2: setPairSchema,
  set3: setPairSchema.nullable().optional(),
});

function scoreWinner(match, entryAId, entryBId) {
  const sets = [
    [match.set1_a, match.set1_b],
    [match.set2_a, match.set2_b],
    [match.set3_a, match.set3_b],
  ].filter((s) => s[0] != null && s[1] != null);
  if (!sets.length) return null;
  let a = 0, b = 0;
  for (const [sa, sb] of sets) { if (sa > sb) a++; else if (sb > sa) b++; }
  if (a === b) return null;
  return a > b ? entryAId : entryBId;
}

async function advanceKnockoutWinner(client, matchRow) {
  if (matchRow.stage === "group") return;
  const parentSlot = Math.floor(matchRow.slot / 2);
  const parentRound = matchRow.round_number + 1;
  const parent = (await client.query(
    `SELECT * FROM tournament_matches WHERE category_id = $1 AND round_number = $2 AND slot = $3 FOR UPDATE`,
    [matchRow.category_id, parentRound, parentSlot],
  )).rows[0];
  if (!parent) return; // final has no parent
  const asA = matchRow.slot % 2 === 0;
  await client.query(
    `UPDATE tournament_matches SET ${asA ? "entry_a_id" : "entry_b_id"} = $1 WHERE id = $2`,
    [matchRow.winner_entry_id, parent.id],
  );
}

app.post("/api/admin/tournaments/matches/:id/result", async (c) => {
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, scoreSchema);
  if (error) return bad(c, error);
  const result = await tx(async (client) => {
    const m = (await client.query(`SELECT * FROM tournament_matches WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!m) return { error: "Match not found.", status: 404 };
    if (!m.entry_a_id || !m.entry_b_id) return { error: "Both sides must be assigned before entering a score.", status: 400 };
    const values = {
      set1_a: data.set1[0], set1_b: data.set1[1],
      set2_a: data.set2[0], set2_b: data.set2[1],
      set3_a: data.set3 ? data.set3[0] : null,
      set3_b: data.set3 ? data.set3[1] : null,
    };
    const winner = scoreWinner({ ...m, ...values }, m.entry_a_id, m.entry_b_id);
    if (!winner) return { error: "Scores don't determine a winner.", status: 400 };
    const updated = (await client.query(
      `UPDATE tournament_matches
         SET set1_a = $1, set1_b = $2, set2_a = $3, set2_b = $4, set3_a = $5, set3_b = $6,
             winner_entry_id = $7, status = 'confirmed', confirmed_at = now(),
             reported_by = NULL, reported_at = NULL
       WHERE id = $8 RETURNING *`,
      [values.set1_a, values.set1_b, values.set2_a, values.set2_b, values.set3_a, values.set3_b, winner, id],
    )).rows[0];
    await advanceKnockoutWinner(client, updated);
    return { ok: true };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json({ ok: true });
});

app.post("/api/admin/tournaments/matches/:id/confirm", async (c) => {
  const id = Number(c.req.param("id"));
  const result = await tx(async (client) => {
    const m = (await client.query(`SELECT * FROM tournament_matches WHERE id = $1 FOR UPDATE`, [id])).rows[0];
    if (!m) return { error: "Match not found.", status: 404 };
    if (m.status !== "reported") return { error: "Nothing to confirm — no result reported.", status: 409 };
    const winner = scoreWinner(m, m.entry_a_id, m.entry_b_id);
    if (!winner) return { error: "Reported score is invalid — reject and re-enter.", status: 400 };
    const updated = (await client.query(
      `UPDATE tournament_matches SET winner_entry_id = $1, status = 'confirmed', confirmed_at = now()
       WHERE id = $2 RETURNING *`,
      [winner, id],
    )).rows[0];
    await advanceKnockoutWinner(client, updated);
    return { ok: true };
  });
  if (result.error) return bad(c, result.error, result.status);
  return c.json({ ok: true });
});

app.post("/api/admin/tournaments/matches/:id/reject", async (c) => {
  const id = Number(c.req.param("id"));
  const { rows } = await query(
    `UPDATE tournament_matches
       SET status = 'pending', reported_by = NULL, reported_at = NULL,
           set1_a = NULL, set1_b = NULL, set2_a = NULL, set2_b = NULL, set3_a = NULL, set3_b = NULL,
           winner_entry_id = NULL
     WHERE id = $1 RETURNING id`,
    [id],
  );
  if (!rows[0]) return bad(c, "Match not found.", 404);
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
  const ts = new Date().toISOString();
  const ip = clientIp(c);
  console.error(`[${ts}] ${c.req.method} ${c.req.path} from ${ip} →`, err?.stack || err);
  return bad(c, "Something went wrong on our side. Please try again.", 500);
});

// Last-resort catchers so a bad promise doesn't crash the server silently.
process.on("unhandledRejection", (reason) => {
  console.error(`[${new Date().toISOString()}] unhandledRejection:`, reason);
});
process.on("uncaughtException", (err) => {
  console.error(`[${new Date().toISOString()}] uncaughtException:`, err?.stack || err);
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
