# Friends Club 🏸

Badminton session booking for our Prague group. Admins post polls, players join (with Multisport or paying at the venue) and bring guests. At the entrance, players scan their Multisport card and get marked **paid**.

## What's inside

| Area | What it does |
| --- | --- |
| **Calendar** (`/`) | Month calendar highlighting dates with a posted poll; ✓ marks sessions you're in. Join with name, Multisport card (number + name on card) or "pay at venue", plus guests. Confetti confirmation card. |
| **My sessions** (`/my-sessions`) | Your upcoming sessions: date, time, venue, players going, court number(s) once assigned. Leave a session. Players have no accounts — each device gets an anonymous player id. |
| **Admin → Polls** | Post polls for one or many dates at once, assign court numbers, close/reopen voting, edit, delete, see/remove players, approve other admins. |
| **Admin → Check-in** | Camera scanner for Multisport QR codes and barcodes (plus manual entry). Live **Paid / Pending / Others** lists; tap a row to mark paid by hand. Full-screen kiosk mode. |
| **Admin → Records** | Everything from the last 7 days. Sessions older than 7 days — including stored card numbers — are deleted automatically (hourly and on admin load). |

The first account created at `/admin/login` becomes the admin. Later sign-ups wait until an admin approves them on the Polls page.

## Stack

- React 19 + Vite + Tailwind CSS 4 + Framer Motion (UI originally prototyped in Lovable)
- Hono on Node 22 serving the API and the built frontend
- PostgreSQL (tables are created automatically on startup)

## Run locally

```bash
npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/friends
npm run dev        # API on :3000, Vite on :5173 (proxies /api)
```

Production: `npm run build && npm start`.

## Environment variables

| Name | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Postgres connection string (on Railway: reference the Postgres service's `DATABASE_URL`). |
| `NODE_ENV` | recommended | Set to `production` so admin cookies are `Secure`. |
| `CLUB_TIMEZONE` | no | Defaults to `Europe/Prague`; used for "today" and the 7-day retention. |
| `PORT` | no | Provided by the host. |
| `SITE_URL` | no | Canonical address, defaults to `https://friends-club.cz`. Used for canonical links, sitemap and redirects. |
| `GOOGLE_SITE_VERIFICATION` | no | Token from Google Search Console's "HTML tag" method, if you verify that way. |

## Deploy (Railway)

`railway.json` builds with `npm run build`, starts with `npm start` and health-checks `/api/health`. Add a Postgres database to the project, set `DATABASE_URL` and `NODE_ENV=production` on the app service, and generate a domain. The camera scanner needs HTTPS, which Railway domains provide.

## SEO

- `server/seo.js` renders each page's `<title>`, description, canonical link, Open Graph/Twitter tags and robots rules on the server.
- The homepage also gets crawlable HTML (upcoming sessions, how it works, FAQ) and JSON-LD for the club, the FAQ and each upcoming session (`SportsEvent`).
- `/robots.txt` and `/sitemap.xml` are generated. Admin pages and My sessions are `noindex`; unknown URLs return a real 404.
- Canonical links point every copy of the site (www, `*.onrender.com`) at `https://friends-club.cz`. Do www → apex redirects in Render's custom-domain settings, not in the app.
- FAQ and "How it works" text live in `shared/site.json`, used by both the app and the server.
