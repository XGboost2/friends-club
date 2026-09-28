# Testing

The project uses [Vitest](https://vitest.dev/). Two commands:

```
npm test         # single run
npm run test:watch
```

## What's covered today

Only a small suite of pure helper unit tests lives in `tests/`. They exist to
prove the harness works and to lock down utility behaviour that other code
depends on (`cardKey` for Multisport check-in, `needsPartner` for tournament
categories, `defaultGuestName` for the join sheet).

## Adding integration tests

Integration tests should drive the real HTTP handlers against a real Postgres.
Recommended setup:

1. **Test database.** Create a *separate* Neon branch (Neon → Branches → New
   branch) or run a local Postgres via Docker:
   ```
   docker run --rm -it -p 5433:5432 -e POSTGRES_PASSWORD=test postgres:16
   ```
   Set `DATABASE_URL_TEST=postgres://postgres:test@localhost:5433/postgres`.

2. **Boot the server in-process.** Import the Hono `app` and use
   `app.request(url, init)` — no network, no port conflict. Example skeleton:

   ```js
   import { describe, it, expect, beforeAll, afterAll } from "vitest";
   import { migrate, query } from "../server/db.js";

   let app;
   beforeAll(async () => {
     process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
     await migrate();
     await query(`TRUNCATE players, sessions, tournaments RESTART IDENTITY CASCADE`);
     ({ default: app } = await import("../server/index.js"));  // adjust if index.js doesn't default-export
   });

   afterAll(async () => {
     await query(`TRUNCATE players, sessions, tournaments RESTART IDENTITY CASCADE`);
   });

   it("registers a player via OTP", async () => {
     await app.request("/api/auth/request-otp", {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify({ email: "test@example.com", purpose: "register" }),
     });
     const otp = (await query(`SELECT code_hash FROM otp_codes WHERE email = $1`, ["test@example.com"])).rows[0];
     // …verify flow, then …
   });
   ```

3. **Bypass real email.** Leave `RESEND_API_KEY` unset in the test env —
   `server/email.js` will log codes to console instead of sending. Read the
   `otp_codes` row directly to get the hashed code, then pass a plaintext code
   your test knows about (easiest to inject via `bcrypt.hash` yourself).

4. **Suggested first suites**, in order of value:
   - Register → verify OTP → login → sign out
   - Join a session → hit the auto-close boundary → leave a session
   - Tournament: create category → register (with existing partner) → register
     (with off-app partner) → withdraw → admin edits
   - Retention sweep leaves fresh data alone and clears the right stuff

5. **CI hook (optional).** GitHub Actions can run `npm test` on push. If you
   need integration coverage in CI, spin up Postgres as a service in the
   workflow and set `DATABASE_URL_TEST` from GitHub Secrets.

## Testing philosophy

- Keep it thin. This is a small club app; do not over-test.
- Prefer integration tests over unit tests where a route touches the DB — mocking
  Postgres for a schema this simple wastes more time than it saves.
- Only mock outside-world things (Resend, Twilio, etc.), not our own code.
