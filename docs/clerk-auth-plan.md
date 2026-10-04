# Clerk Auth Integration Plan

Replace the current email-OTP login with Clerk for a proper OAuth-capable login manager.

## Why Clerk

- Drop-in React components (`<SignIn />`, `<UserButton />`) — no custom UI needed
- OAuth providers (Google, GitHub, Apple, etc.) toggled from Clerk dashboard — no per-provider OAuth app setup for dev
- Session verification on the server is a single middleware
- Clerk delivers its own OTP / magic-link emails — **no separate email provider needed**
- Free tier: 10k MAU, unlimited auths, email OTP + OAuth included (SMS is $0.01/msg if ever enabled)

## Current state (as of 2026-10-04)

- Custom email-OTP flow in `server/index.js`:
  - `POST /api/auth/request-otp`
  - `POST /api/auth/verify-otp`
  - `POST /api/auth/logout`
- OTP delivery via **Resend** (`server/email.js` — single `sendOtp` export, no other usage)
- Player sessions stored in `player_sessions` table (token hash + expiry) — see `server/db.js`
- Admin sessions in `admin_sessions` table (separate flow)
- Players table is the source of truth for app data (name, etc.)

**Note**: Resend is used only for OTP. Once Clerk takes over login, Resend has zero remaining purpose → drop it entirely as part of this rollout.

## Architecture

Clerk owns **identity**: email, OAuth tokens, password resets, MFA, session lifecycle.
Our `players` table owns **app data**: name, skill level, registrations, etc.

Link them with a new `clerk_user_id` column on `players`.

```
Clerk (identity)  ──clerk_user_id──▶  players (app data)  ──▶  registrations, guests, ...
```

## Open questions to answer before implementing

1. **Clerk credentials** — need account at clerk.com and:
   - `VITE_CLERK_PUBLISHABLE_KEY` (frontend, in `.env`)
   - `CLERK_SECRET_KEY` (server, in `.env`)
2. **OAuth providers** — which to enable in Clerk dashboard? (Google only vs Google + GitHub + Apple)
3. **Migration scope** — replace OTP entirely, or run both in parallel?
   - Recommendation: replace. Two login paths = double maintenance.
4. **Admin login** — move admins to Clerk too (with role check via Clerk metadata), or leave `admin_sessions` untouched?
   - Recommendation: leave admin flow alone for now to minimize blast radius; migrate later.
5. **Existing players** — how to link current OTP-registered players to new Clerk accounts?
   - Option A: on first Clerk login, match by email → attach `clerk_user_id` to existing player row.
   - Option B: hard cutover, players re-register.

## Implementation checklist

### Frontend (`src/`)

- [ ] `npm i @clerk/clerk-react`
- [ ] Wrap `<App>` in `<ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>` in `src/main.tsx`
- [ ] Replace login page (`src/pages/…`) with Clerk's `<SignIn />` component
- [ ] Add `<UserButton />` to header
- [ ] Use `useAuth()` hook to get session token for API calls; attach as `Authorization: Bearer <token>` header
- [ ] Remove the old OTP request/verify UI

### Backend (`server/`)

- [ ] `npm i @clerk/backend`
- [ ] Add Clerk middleware in `server/index.js` — verify `Authorization` header on protected routes, expose `c.get('clerkUserId')`
- [ ] Rewrite `requirePlayer` middleware to:
  - Read `clerkUserId` from context
  - Look up `players` row by `clerk_user_id`
  - If not found, auto-create using Clerk user's email + name (first-login provisioning)
- [ ] Delete `/api/auth/request-otp`, `/api/auth/verify-otp`, `/api/auth/logout` (or leave logout as a no-op)
- [ ] Delete `server/email.js` (only used for OTP, no longer needed)
- [ ] `npm uninstall resend` (or whichever Resend SDK is installed)
- [ ] Remove `RESEND_*` env references from `server/index.js` if any

### Database (`server/db.js`)

- [ ] Add migration: `ALTER TABLE players ADD COLUMN clerk_user_id TEXT UNIQUE`
- [ ] Add index on `clerk_user_id` for lookup speed
- [ ] Deprecate/drop `player_sessions` table (no longer needed — Clerk holds sessions)
- [ ] Deprecate/drop `otp_codes` table (or whatever holds the OTP challenges)
- [ ] Keep `admin_sessions` untouched (see open question #4)

### Environment

- [ ] Add to `.env.example`:
  ```
  VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
  CLERK_SECRET_KEY=sk_test_...
  ```
- [ ] Remove from `.env.example` and any deploy env (Railway/Render): `RESEND_API_KEY`, `RESEND_FROM`, and any other Resend-related vars
- [ ] Update `README.md` with Clerk setup steps (and drop any Resend setup section)

### Testing

- [ ] Manual: sign up new user via Google → verify player row created with `clerk_user_id`
- [ ] Manual: existing OTP-registered user logs in via Clerk with same email → verify `clerk_user_id` back-fills existing row
- [ ] Manual: sign out → protected routes return 401
- [ ] Update `tests/helpers.test.js` if it touches auth

## Custom email domain (`@friends-club.cz`)

Clerk can send auth emails from your own domain — no Resend/SMTP needed. Clerk handles DKIM signing, templates, and deliverability.

### Prerequisites
- Clerk app must be a **production instance** (dev/test instances only send from Clerk's shared domain). Promote the app from "Development" to "Production" in the Clerk dashboard once ready.
- A working inbox at the from-address (e.g. `notifications@friends-club.cz`) to receive bounces/replies.

### Setup steps
- [ ] In Clerk dashboard → Domains → add `friends-club.cz` as the production domain
- [ ] Add the DNS records Clerk provides at your domain registrar:
  - **SPF** (TXT): e.g. `v=spf1 include:_spf.mx.cloudflare.net ~all` (exact value from Clerk)
  - **DKIM** (CNAME records): Clerk generates these — paste them into DNS
  - **DMARC** (TXT): set up manually, e.g. `v=DMARC1; p=none; rua=mailto:dmarc@friends-club.cz`
- [ ] Wait for DNS propagation (minutes to a few hours) — Clerk shows a "verified" status when ready
- [ ] Set the default from-address via Clerk Backend API or dashboard (default is `notifications@friends-club.cz`; change to `hello@friends-club.cz` or similar if preferred)
- [ ] Verify a working inbox exists at the from-address

### Email template customization
- [ ] In Clerk dashboard → Customization → Emails: edit subject lines, HTML body, logo, colors
- [ ] Test: trigger a login OTP → confirm it arrives from `@friends-club.cz`, DKIM-signed, with branded styling

### Deliverability monitoring
- [ ] First few days after going live: watch Clerk's email logs for bounces/complaints (new sending domains need a brief warm-up period — Clerk ramps volume automatically)
- [ ] Add `dmarc@friends-club.cz` inbox or forward DMARC reports somewhere readable

## Rollout order

1. Get Clerk keys + enable providers in dashboard
2. DB migration (add `clerk_user_id`)
3. Backend middleware + updated `requirePlayer`
4. Frontend `<ClerkProvider>` + `<SignIn />`
5. Test end-to-end
6. Remove old OTP routes and tables
7. Delete `server/email.js`, uninstall `resend`, strip Resend env vars from deploy configs
8. Promote Clerk app to production instance + configure custom domain (`@friends-club.cz`) — see "Custom email domain" section

## Future note

If app-level emails are ever needed later (session reminders, "you've been added to a match", confirmations), Resend can be re-added as a transactional-email service only — not as part of auth.

## Estimated effort

~30 min once keys are in hand and questions above are answered.
