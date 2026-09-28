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
  // new registration flow (email verification) starts from a clean slate.
  const check = await query(`SELECT to_regclass('public.players') AS t`);
  if (!check.rows[0].t) {
    await query(`DROP TABLE IF EXISTS guests, registrations, sessions CASCADE`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS players (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      phone TEXT NOT NULL,
      name TEXT NOT NULL,
      level TEXT NOT NULL CHECK (level IN ('beginner','intermediate','advanced')),
      blocked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      email TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose IN ('register','login')),
      code_hash TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (email, purpose)
    );

    CREATE TABLE IF NOT EXISTS player_sessions (
      token_hash TEXT PRIMARY KEY,
      player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS player_sessions_player_idx ON player_sessions(player_id);

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
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS sessions_date_idx ON sessions(date);

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
  `);
}

/** Keep two weeks of history: drop sessions (and their players, guests, card numbers) older than 14 days. */
export async function cleanupOldRecords() {
  const { rowCount } = await query(`DELETE FROM sessions WHERE date < current_date - 14`);
  await query(`DELETE FROM admin_sessions WHERE expires_at < now()`);
  await query(`DELETE FROM player_sessions WHERE expires_at < now()`);
  await query(`DELETE FROM otp_codes WHERE expires_at < now() - interval '1 day'`);
  if (rowCount) console.log(`Retention: removed ${rowCount} session(s) older than 14 days`);
  return rowCount;
}
