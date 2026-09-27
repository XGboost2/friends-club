import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { CLUB_TZ, query, tx, migrate, cleanupOldRecords } from "./db.js";
import { renderPage, robotsTxt, sitemapXml } from "./seo.js";

const app = new Hono();
const isProd = process.env.NODE_ENV === "production";
const COOKIE = "fc_admin";
const SESSION_DAYS = 30;
const CANCEL_LOCK_HOURS = 25;

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

const SESSION_STATS_SQL = `
  SELECT s.*,
    ((s.date::text || ' ' || s.start_time)::timestamp AT TIME ZONE '${CLUB_TZ}') AS start_at,
    (SELECT count(*) FROM registrations r WHERE r.session_id = s.id) AS player_count,
    (SELECT count(*) FROM guests g JOIN registrations r ON r.id = g.registration_id WHERE r.session_id = s.id) AS guest_count,
    COALESCE((SELECT json_agg(r.player_name ORDER BY r.created_at) FROM registrations r WHERE r.session_id = s.id), '[]'::json) AS players
  FROM sessions s`;

// ---------- public API ----------
app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/sessions", async (c) => {
  const { rows } = await query(`${SESSION_STATS_SQL} WHERE s.date >= current_date ORDER BY s.date, s.start_time`);
  const today = (await query(`SELECT current_date AS d`)).rows[0].d;
  return c.json({ today, sessions: rows.map(mapSession) });
});

app.get("/api/sessions/:id/attendees", async (c) => {
  const id = Number(c.req.param("id"));
  const { rows } = await query(
    `SELECT r.player_name, r.uses_multisport,
       COALESCE((SELECT json_agg(g.name ORDER BY g.id) FROM guests g WHERE g.registration_id = r.id), '[]'::json) AS guests
     FROM registrations r WHERE r.session_id = $1 ORDER BY r.created_at`,
    [id],
  );
  return c.json({ attendees: rows.map((r) => ({ name: r.player_name, multisport: r.uses_multisport, guests: r.guests })) });
});

const joinSchema = z.object({
  playerId: z.string().trim().min(8).max(64),
  name: z.string().trim().min(1, "enter your name").max(60),
  usesMultisport: z.boolean(),
  cardNumber: z.string().trim().max(40).optional().nullable(),
  holderName: z.string().trim().max(80).optional().nullable(),
  guests: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
});

app.post("/api/sessions/:id/join", async (c) => {
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, joinSchema);
  if (error) return bad(c, error);
  if (data.usesMultisport) {
    if (cardKey(data.cardNumber).length < 6) return bad(c, "Enter your Multisport card number (at least 6 characters).");
    if (!data.holderName) return bad(c, "Enter the name on the Multisport card.");
  }
  try {
    const result = await tx(async (client) => {
      const s = (await client.query(`SELECT * FROM sessions WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!s) return { status: 404, error: "This session no longer exists." };
      if (s.status !== "open") return { status: 409, error: "Voting for this session is closed." };
      const past = (await client.query(`SELECT $1::date < current_date AS past`, [s.date])).rows[0].past;
      if (past) return { status: 409, error: "This session is in the past." };
      const existing = (await client.query(`SELECT id FROM registrations WHERE session_id = $1 AND player_id = $2`, [id, data.playerId])).rows[0];
      if (existing) return { status: 409, error: "You're already in this session." };
      const sameName = (await client.query(`SELECT 1 FROM registrations WHERE session_id = $1 AND lower(player_name) = lower($2)`, [id, data.name])).rows[0];
      if (sameName) return { status: 409, error: `Someone named ${data.name} is already in. If that's you, check My sessions — otherwise add your surname.` };
      if (data.usesMultisport) {
        const sameCard = (await client.query(`SELECT 1 FROM registrations WHERE session_id = $1 AND card_key = $2`, [id, cardKey(data.cardNumber)])).rows[0];
        if (sameCard) return { status: 409, error: "This Multisport card is already registered for this session." };
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
        [id, data.playerId, data.name, data.usesMultisport,
          data.usesMultisport ? data.cardNumber.trim() : null,
          data.usesMultisport ? cardKey(data.cardNumber) : null,
          data.usesMultisport ? data.holderName : null],
      )).rows[0];
      for (const guest of data.guests) {
        await client.query(`INSERT INTO guests (registration_id, name) VALUES ($1, $2)`, [reg.id, guest]);
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
  const id = Number(c.req.param("id"));
  const { data, error } = await parseBody(c, z.object({ playerId: z.string().min(8).max(64) }));
  if (error) return bad(c, error);
  const session = (await query(
    `SELECT ((date::text || ' ' || start_time)::timestamp AT TIME ZONE $1) > now() + interval '${CANCEL_LOCK_HOURS} hours' AS can_leave
       FROM sessions WHERE id = $2`,
    [CLUB_TZ, id],
  )).rows[0];
  if (!session) return bad(c, "This session no longer exists.", 404);
  if (!session.can_leave) return bad(c, `Too late to cancel — sessions lock ${CANCEL_LOCK_HOURS} hours before the start time.`, 409);
  const { rowCount } = await query(
    `DELETE FROM registrations WHERE session_id = $1 AND player_id = $2`,
    [id, data.playerId],
  );
  if (!rowCount) return bad(c, "Booking not found.", 404);
  return c.json({ ok: true });
});

app.get("/api/my-sessions", async (c) => {
  const playerId = c.req.query("playerId") || "";
  const name = (c.req.query("name") || "").trim();
  if (!playerId && !name) return c.json({ sessions: [] });
  const { rows } = await query(
    `${SESSION_STATS_SQL}
     JOIN registrations me ON me.session_id = s.id
     WHERE s.date >= current_date AND ${playerId ? "me.player_id = $1" : "lower(me.player_name) = lower($1)"}
     ORDER BY s.date, s.start_time`,
    [playerId || name],
  );
  const mine = await query(
    `SELECT r.session_id, r.player_id, r.uses_multisport, r.status,
       COALESCE((SELECT json_agg(g.name ORDER BY g.id) FROM guests g WHERE g.registration_id = r.id), '[]'::json) AS guests
     FROM registrations r WHERE ${playerId ? "r.player_id = $1" : "lower(r.player_name) = lower($1)"}`,
    [playerId || name],
  );
  const bySession = new Map(mine.rows.map((r) => [r.session_id, r]));
  const cutoffMs = CANCEL_LOCK_HOURS * 3_600_000;
  return c.json({
    sessions: rows.map((row) => {
      const me = bySession.get(row.id);
      if (!me) return { ...mapSession(row), me: null };
      const isMine = !!playerId && me.player_id === playerId;
      const beforeCutoff = row.start_at ? new Date(row.start_at).getTime() - Date.now() > cutoffMs : false;
      return {
        ...mapSession(row),
        me: {
          multisport: me.uses_multisport,
          status: me.status,
          guests: me.guests,
          isMine,
          canLeave: isMine && beforeCutoff,
        },
      };
    }),
  });
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
    `SELECT r.*, COALESCE((SELECT json_agg(json_build_object('id', g.id, 'name', g.name, 'status', g.status) ORDER BY g.id)
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
    `SELECT id, player_name, card_key, status FROM registrations WHERE session_id = $1 AND uses_multisport AND card_key IS NOT NULL`,
    [data.sessionId],
  );
  // Exact match first, then tolerate prefixes/suffixes that card barcodes sometimes add.
  let match = rows.find((r) => r.card_key === scanned);
  if (!match) {
    const partial = rows.filter((r) => r.card_key.length >= 6 && (scanned.includes(r.card_key) || (scanned.length >= 6 && r.card_key.includes(scanned))));
    if (partial.length === 1) match = partial[0];
  }
  if (!match) return c.json({ result: "unknown", code: data.code });
  if (match.status === "paid") return c.json({ result: "already", name: match.player_name, registrationId: match.id });
  await query(`UPDATE registrations SET status = 'paid', paid_at = now(), paid_method = 'scan' WHERE id = $1`, [match.id]);
  return c.json({ result: "paid", name: match.player_name, registrationId: match.id });
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
setInterval(() => cleanupOldRecords().catch((e) => console.error("cleanup failed", e)), 60 * 60 * 1000);

const port = Number(process.env.PORT || 3000);
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => console.log(`Friends Club running on :${port}`));
