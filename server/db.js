import pg from "pg";

// Return DATE columns as plain 'YYYY-MM-DD' strings (no timezone shifting).
pg.types.setTypeParser(1082, (value) => value);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add a Postgres database and set DATABASE_URL.");
  process.exit(1);
}

const useSsl = /sslmode=require/.test(connectionString) || process.env.PGSSL === "true";

// All date logic (today, 14-day retention) runs in the club's local time zone.
export const CLUB_TZ = (process.env.CLUB_TIMEZONE || "Europe/Prague").replace(/[^A-Za-z0-9_/+-]/g, "");

export const pool = new pg.Pool({
  connectionString,
  ssl: useSsl ? { rejectUnauthorized: false } : undefined,
  max: 10,
  options: `-c TimeZone=${CLUB_TZ}`,
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function migrate() {
  // Admin auth tables stay untouched across the players rollout.
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      approved BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS admin_sessions (
      token_hash TEXT PRIMARY KEY,
      admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
  `);

  // First time the players rollout runs, wipe old device-only bookings so the
  // new registration flow (Clerk) starts from a clean slate.
  const check = await query(`SELECT to_regclass('public.players') AS t`);
  if (!check.rows[0].t) {
    await query(`DROP TABLE IF EXISTS guests, registrations, sessions CASCADE`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      clerk_user_id TEXT UNIQUE,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      name TEXT NOT NULL,
      level TEXT CHECK (level IN ('beginner','intermediate','advanced')),
      multisport_card_number TEXT,
      multisport_holder_name TEXT,
      blocked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Migration for pre-Clerk schemas (no-op on fresh DBs).
    ALTER TABLE players ADD COLUMN IF NOT EXISTS clerk_user_id TEXT UNIQUE;
    ALTER TABLE players ALTER COLUMN phone DROP NOT NULL;
    ALTER TABLE players ALTER COLUMN level DROP NOT NULL;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS multisport_card_number TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS multisport_holder_name TEXT;
  `);

  // Backfill Multisport card onto the player profile from their most recent Multisport
  // registration. Runs once per player (NULL guard makes it idempotent). Lets existing
  // users keep joining without first visiting their profile.
  await query(`
    UPDATE players p
       SET multisport_card_number = r.card_number,
           multisport_holder_name = r.holder_name
      FROM (
        SELECT DISTINCT ON (player_id) player_id, card_number, holder_name
          FROM registrations
          WHERE uses_multisport AND card_number IS NOT NULL
          ORDER BY player_id, created_at DESC
      ) r
     WHERE p.id = r.player_id
       AND p.multisport_card_number IS NULL;
  `);

  await query(`

    -- OTP + player_sessions were owned by the removed email-OTP flow.
    -- Clerk holds sessions now; drop these tables if they still exist from older deploys.
    DROP TABLE IF EXISTS otp_codes;
    DROP TABLE IF EXISTS player_sessions;

    CREATE TABLE IF NOT EXISTS sessions (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      venue TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0),
      courts_count INTEGER NOT NULL DEFAULT 1 CHECK (courts_count > 0),
      court_numbers TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
      reopen_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sessions_date_idx ON sessions(date);
    ALTER TABLE sessions ADD COLUMN IF NOT EXISTS reopen_until TIMESTAMPTZ;

    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      player_name TEXT NOT NULL,
      uses_multisport BOOLEAN NOT NULL DEFAULT FALSE,
      card_number TEXT,
      card_key TEXT,
      holder_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
      paid_at TIMESTAMPTZ,
      paid_method TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (session_id, player_id)
    );
    CREATE INDEX IF NOT EXISTS registrations_player_idx ON registrations(player_id);

    CREATE TABLE IF NOT EXISTS guests (
      id SERIAL PRIMARY KEY,
      registration_id INTEGER NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
      paid_at TIMESTAMPTZ,
      uses_multisport BOOLEAN NOT NULL DEFAULT FALSE,
      card_number TEXT,
      card_key TEXT,
      holder_name TEXT,
      paid_method TEXT
    );

    -- Idempotent add for pre-existing guests tables (post-players rollout upgrades).
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS uses_multisport BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS card_number TEXT;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS card_key TEXT;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS holder_name TEXT;
    ALTER TABLE guests ADD COLUMN IF NOT EXISTS paid_method TEXT;

    -- Tournaments
    CREATE TABLE IF NOT EXISTS tournaments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      starts_on DATE NOT NULL,
      start_time TEXT,
      venue TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','closed','completed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tournaments_starts_on_idx ON tournaments(starts_on);

    CREATE TABLE IF NOT EXISTS tournament_categories (
      id SERIAL PRIMARY KEY,
      tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
      format TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('beginner','intermediate','advanced')),
      is_open BOOLEAN NOT NULL DEFAULT TRUE,
      max_entries INTEGER,
      structure TEXT NOT NULL DEFAULT 'group_ko' CHECK (structure IN ('group','ko','group_ko')),
      group_size INTEGER NOT NULL DEFAULT 4 CHECK (group_size BETWEEN 2 AND 8),
      advance_count INTEGER NOT NULL DEFAULT 2 CHECK (advance_count BETWEEN 1 AND 8),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (tournament_id, format, level)
    );

    -- Idempotent add for upgrades from the earlier singles/doubles/mixed enum.
    ALTER TABLE tournament_categories ADD COLUMN IF NOT EXISTS structure TEXT NOT NULL DEFAULT 'group_ko';
    ALTER TABLE tournament_categories ADD COLUMN IF NOT EXISTS group_size INTEGER NOT NULL DEFAULT 4;
    ALTER TABLE tournament_categories ADD COLUMN IF NOT EXISTS advance_count INTEGER NOT NULL DEFAULT 2;
    UPDATE tournament_categories SET format = 'mens_singles' WHERE format = 'singles';
    UPDATE tournament_categories SET format = 'mens_doubles' WHERE format = 'doubles';
    ALTER TABLE tournament_categories DROP CONSTRAINT IF EXISTS tournament_categories_format_check;
    ALTER TABLE tournament_categories ADD CONSTRAINT tournament_categories_format_check
      CHECK (format IN ('mens_singles','womens_singles','mens_doubles','womens_doubles','mixed'));
    ALTER TABLE tournament_categories DROP CONSTRAINT IF EXISTS tournament_categories_structure_check;
    ALTER TABLE tournament_categories ADD CONSTRAINT tournament_categories_structure_check
      CHECK (structure IN ('group','ko','group_ko'));

    CREATE TABLE IF NOT EXISTS tournament_registrations (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      partner_id INTEGER REFERENCES players(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (category_id, player_id),
      CHECK (partner_id IS NULL OR partner_id <> player_id)
    );
    CREATE INDEX IF NOT EXISTS tournament_registrations_partner_idx ON tournament_registrations(partner_id);
    -- No two rows in the same category may point to the same partner.
    CREATE UNIQUE INDEX IF NOT EXISTS tournament_registrations_partner_unique
      ON tournament_registrations(category_id, partner_id) WHERE partner_id IS NOT NULL;

    -- Allow pairing with someone who doesn't have an account yet.
    ALTER TABLE tournament_registrations ADD COLUMN IF NOT EXISTS partner_name TEXT;

    -- Fixtures: groups + matches
    CREATE TABLE IF NOT EXISTS tournament_groups (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      position INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (category_id, position)
    );

    CREATE TABLE IF NOT EXISTS tournament_group_entries (
      group_id INTEGER NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
      registration_id INTEGER NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
      seed INTEGER,
      PRIMARY KEY (group_id, registration_id),
      UNIQUE (registration_id)
    );

    CREATE TABLE IF NOT EXISTS tournament_matches (
      id SERIAL PRIMARY KEY,
      category_id INTEGER NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
      stage TEXT NOT NULL CHECK (stage IN ('group','r32','r16','quarter','semi','final')),
      group_id INTEGER REFERENCES tournament_groups(id) ON DELETE CASCADE,
      round_number INTEGER,
      slot INTEGER,
      entry_a_id INTEGER REFERENCES tournament_registrations(id) ON DELETE SET NULL,
      entry_b_id INTEGER REFERENCES tournament_registrations(id) ON DELETE SET NULL,
      winner_entry_id INTEGER REFERENCES tournament_registrations(id) ON DELETE SET NULL,
      set1_a INTEGER, set1_b INTEGER,
      set2_a INTEGER, set2_b INTEGER,
      set3_a INTEGER, set3_b INTEGER,
      court TEXT,
      scheduled_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reported','confirmed')),
      reported_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
      reported_at TIMESTAMPTZ,
      confirmed_at TIMESTAMPTZ,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS tournament_matches_category_idx ON tournament_matches (category_id, stage);
    CREATE INDEX IF NOT EXISTS tournament_matches_scheduled_idx ON tournament_matches (scheduled_at);
  `);
}

/**
 * Retention policy — runs on boot and every hour.
 *
 *   sessions          : dropped 14 days after the session date (cascades registrations + guests + cards)
 *   tournaments       : dropped 90 days after starts_on (cascades categories + registrations + matches)
 *   admin_sessions    : any row past its expires_at
 *
 * Players are never auto-deleted. Admins can remove players manually from the Players screen.
 */
export async function cleanupOldRecords() {
  const stats = {};
  const run = async (label, sql) => {
    const { rowCount } = await query(sql);
    if (rowCount) stats[label] = rowCount;
    return rowCount;
  };

  await run("sessions", `DELETE FROM sessions WHERE date < current_date - 14`);
  await run("tournaments", `DELETE FROM tournaments WHERE starts_on < current_date - 90`);
  await run("admin_sessions", `DELETE FROM admin_sessions WHERE expires_at < now()`);

  if (Object.keys(stats).length) {
    const parts = Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(", ");
    console.log(`Retention swept: ${parts}`);
  }
  return stats;
}

/** Snapshot of table sizes + oldest rows — for the admin storage panel and Neon watch-dog. */
export async function storageStats() {
  const tables = [
    { table: "sessions", ageColumn: "date" },
    { table: "registrations", ageColumn: "created_at" },
    { table: "guests", ageColumn: null },
    { table: "players", ageColumn: "created_at" },
    { table: "tournaments", ageColumn: "starts_on" },
    { table: "tournament_categories", ageColumn: null },
    { table: "tournament_registrations", ageColumn: "created_at" },
    { table: "admins", ageColumn: "created_at" },
    { table: "admin_sessions", ageColumn: null },
  ];
  const out = [];
  for (const { table, ageColumn } of tables) {
    const oldest = ageColumn ? `, min(${ageColumn})::text AS oldest` : `, NULL AS oldest`;
    const { rows } = await query(`SELECT count(*)::int AS count ${oldest} FROM ${table}`);
    out.push({ table, count: rows[0].count, oldest: rows[0].oldest });
  }
  const db = await query(`SELECT pg_database_size(current_database())::bigint AS bytes`);
  return { tables: out, databaseBytes: Number(db.rows[0].bytes) };
}
