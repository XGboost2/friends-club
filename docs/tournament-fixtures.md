# Tournament fixtures, scoring & leaderboard — plan

Design document for the next Friends Club feature pass: turning tournament
**registrations** into **fixtures**, capturing **scores**, and publishing a
public **leaderboard**. Written before implementation so we can align on scope
and data model.

---

## 1. Goals

- Admin picks the **structure** per category: group only, knockout only, or
  group stage followed by knockout.
- **Hybrid seeding**: default random draw, admin can swap slots.
- **Court + time per match**, controlled by admin, so different categories can
  play at different times of day (men's doubles morning, mixed afternoon…).
- **Best-of-3 sets** scoring with per-set point totals.
- **Player-submitted results** ("we won 21–15, 19–21, 21–17"), **admin
  confirmation** before the leaderboard updates and knockout winners advance.
- **Public read-only leaderboard** per category, showing standings and
  qualifying status for group stage.
- **Add two new formats**: women's singles and women's doubles.

## 2. Non-goals for this pass

Kept out to stay shippable. Any of these can be a follow-up.

- Fancy SVG bracket tree with connector lines (matches will render as
  round-by-round cards instead).
- Third-place playoff.
- Drag-and-drop seed shuffling (we'll use "swap two slots" dropdowns).
- Live scoring / per-rally updates.
- Consolation / plate brackets for early losers.
- Score edits after admin confirmation (admin can force-edit via the entry
  panel, but there's no explicit "dispute" flow).
- Photo/video attachments on results.
- Push notifications.

## 3. New player-facing category formats

The current `tournament_categories.format` CHECK constraint allows
`singles | doubles | mixed`. We expand to five:

| Value              | Display label      | Partner needed |
| ------------------ | ------------------ | -------------- |
| `mens_singles`     | Men's singles      | No             |
| `womens_singles`   | Women's singles    | No             |
| `mens_doubles`     | Men's doubles      | Yes            |
| `womens_doubles`   | Women's doubles    | Yes            |
| `mixed`            | Mixed doubles      | Yes            |

We do **not** collect gender on `players`. Admin picks the category correctly
when creating; if someone registers in the wrong bucket the admin edits it
(same as today).

**Migration (idempotent):**

```sql
UPDATE tournament_categories SET format = 'mens_singles'  WHERE format = 'singles';
UPDATE tournament_categories SET format = 'mens_doubles'  WHERE format = 'doubles';
ALTER TABLE tournament_categories DROP CONSTRAINT IF EXISTS tournament_categories_format_check;
ALTER TABLE tournament_categories ADD CONSTRAINT tournament_categories_format_check
  CHECK (format IN ('mens_singles','womens_singles','mens_doubles','womens_doubles','mixed'));
```

Server helper `needsPartner(fmt)` becomes `!fmt.endsWith('singles')`.

## 4. Category configuration

New columns on `tournament_categories`:

| Column          | Type     | Default   | Notes                                                    |
| --------------- | -------- | --------- | -------------------------------------------------------- |
| `structure`     | text     | `group_ko`| One of `group` / `ko` / `group_ko`                       |
| `group_size`    | int      | `4`       | Target entries per group when we split                   |
| `advance_count` | int      | `2`       | Top N per group who advance to knockout                  |

Constraint: `structure IN ('group','ko','group_ko')`.

Admins can change these values as long as no fixtures are generated yet.
Once fixtures exist we lock the fields (edit requires "Regenerate fixtures"
which wipes matches).

## 5. New tables

### 5.1 `tournament_groups`
One row per group (Group A, Group B, …) inside a category.

```sql
CREATE TABLE tournament_groups (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,             -- 'A', 'B', 'C', ...
  position INTEGER NOT NULL,      -- 0-based order
  UNIQUE (category_id, position)
);
```

### 5.2 `tournament_group_entries`
Assignment of registrations to groups.

```sql
CREATE TABLE tournament_group_entries (
  group_id INTEGER NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
  registration_id INTEGER NOT NULL REFERENCES tournament_registrations(id) ON DELETE CASCADE,
  seed INTEGER,                    -- position within group (1..n)
  PRIMARY KEY (group_id, registration_id),
  UNIQUE (registration_id)         -- each entry lives in exactly one group
);
```

### 5.3 `tournament_matches`
One row per scheduled or bye match.

```sql
CREATE TABLE tournament_matches (
  id SERIAL PRIMARY KEY,
  category_id INTEGER NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('group','r32','r16','quarter','semi','final')),
  group_id INTEGER REFERENCES tournament_groups(id) ON DELETE CASCADE,   -- group stage only
  round_number INTEGER,             -- knockout: 1 = first round, then QF/SF/F
  slot INTEGER,                     -- knockout: bracket slot index
  entry_a_id INTEGER REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  entry_b_id INTEGER REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  winner_entry_id INTEGER REFERENCES tournament_registrations(id) ON DELETE SET NULL,
  set1_a INTEGER, set1_b INTEGER,
  set2_a INTEGER, set2_b INTEGER,
  set3_a INTEGER, set3_b INTEGER,
  court TEXT,
  scheduled_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','reported','confirmed')),
  reported_by INTEGER REFERENCES players(id) ON DELETE SET NULL,
  reported_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON tournament_matches (category_id, stage);
CREATE INDEX ON tournament_matches (scheduled_at);
```

Notes on the shape:

- Per-set columns (rather than JSONB) so leaderboard queries can `SUM(set1_a +
  set2_a + set3_a)` directly.
- `winner_entry_id` is redundant given set scores but we set it explicitly at
  confirmation time. Simplifies advancement queries and handles walkovers
  (bye rows where one entry is null).
- `status` transitions: `pending` → `reported` (player submits) → `confirmed`
  (admin approves). Admin can also enter directly → `confirmed`.

## 6. Fixture generation

Admin-triggered. Regeneration deletes existing matches in the category
first (with a confirmation dialog).

### 6.1 Group stage

Given `N` entries and target `group_size`:

1. Shuffle entries with a seeded RNG (so "reshuffle" gives a new but reproducible
   draw for this generation).
2. Number of groups `G = ceil(N / group_size)`.
3. Distribute entries **snake style**: entries 1..G go to groups 1..G, then
   G+1..2G go to groups G..1, etc. Balances any implicit ranking baked into
   registration order.
4. Within each group of size `k`, create `k*(k-1)/2` all-vs-all matches with
   `stage = 'group'`, `group_id = <this group>`, no court/time yet.

Standard round-robin pairing table for small `k` (used to spread rest between
matches):

- k=3: (1-2)(3-1)(2-3)
- k=4: (1-4)(2-3)(1-3)(2-4)(3-4)(1-2)  ← Berger tables

### 6.2 Knockout — direct (`structure = 'ko'`)

1. Bracket size = next power of two ≥ `N`.
2. Shuffle entries (hybrid: random by default, admin can swap after).
3. Assign entries to bracket slots using the standard seeding order
   `[1, N, N/2+1, N/2, …]` so top seeds meet last if we ever add seed rankings.
4. Empty slots become **byes**: opponent is `null`, the present entry
   auto-advances at generation time (creates `stage=next` match with entry
   pre-filled).
5. Round labels: mapping from `round_number` → stage
   - Final: `final`
   - Semi-final: `semi`
   - Quarter-final: `quarter`
   - Earlier: `r16`, `r32` (we won't support anything larger for now)

### 6.3 Group → Knockout (`structure = 'group_ko'`)

1. Generate group matches (§6.1).
2. Show admin a "Generate knockout" button, only enabled once every group
   match is `confirmed`.
3. Compute standings per group (see §8).
4. Take top `advance_count` from each group. The knockout bracket size is
   `G * advance_count` (rounded up to next power of two, byes as needed).
5. Cross-pair to avoid group members meeting immediately:
   - A1 vs B2, B1 vs A2, C1 vs D2, D1 vs C2, …
6. Populate slots and create matches.

## 7. Scheduling (court + time)

Both `court` and `scheduled_at` are optional. Admin sets them per match from
the fixtures grid. Filter helpers on the admin page:

- "Set time for all group matches in this category to …"
- "Assign courts 1–4 sequentially" (round-robin across empty matches)

Player view groups matches by day and then by court, so it looks like a
schedule sheet: `Court 1: 10:00 Alice/Bob vs Carlos/Diego`.

## 8. Scoring & leaderboard

### 8.1 Set scoring

For each match:

- Player enters up to 3 sets. Each set has two integer scores.
- Winner rule: whoever wins ≥2 sets. Set winner = higher score.
- Set 3 is only entered if the first two are split 1-1.
- No enforcement of "21 with 2-point lead" — badminton has house rules; we
  trust what players report and admin can reject if wrong.

### 8.2 Standings (group stage)

For each entry in a group, tally over that group's `confirmed` matches:

- **Played** (`P`)
- **Won** (`W`) – matches won
- **Lost** (`L`)
- **Sets won** (`SW`), **Sets lost** (`SL`), **Set diff** (`SD = SW − SL`)
- **Points for** (`PF` = sum of own set scores), **Points against** (`PA`),
  **Point diff** (`PD = PF − PA`)

**Rank order**: `W` desc → `SD` desc → `PD` desc → `PF` desc → alphabetical.

**Qualifying status**: entries ranked in the top `advance_count` are marked
`qualified`. Below that: `eliminated` once all their group matches are
confirmed and they can't mathematically climb into the top `advance_count`
(computed lazily). Until then: `in-contention`.

### 8.3 Knockout advancement

On confirming a match:

- Set `winner_entry_id`.
- Find the child match (`round_number - 1` toward the final) via
  `slot = floor(current_slot / 2)`. Insert winner as entry_a or entry_b
  depending on parity.
- If both children of a slot are filled, the parent match is ready to be
  scheduled/played.

Loser goes nowhere (no plate bracket in v1).

## 9. Reporting & confirmation flow

- Either registered player in the match sees "Report result" on their own
  fixtures page. Non-registered partners can't report (no login) — the
  registered teammate does it.
- Report form: three set inputs. Winner auto-computed from set scores.
  Submit → status `reported`, `reported_by = current player`.
- Admin sees a "**Needs review**" badge next to reported matches. One-click
  **Confirm** → status `confirmed`, `winner_entry_id` set, knockout advances,
  leaderboard recomputes.
- Admin **Reject** clears the scores and returns match to `pending` with a
  toast telling the reporter to re-enter.
- Admin **Enter result** works directly for a `pending` match, skipping
  reporting entirely (useful for matches played on paper).

## 10. Admin UI

New per-tournament panel with tabs per category. Each category tab shows:

1. **Config**: structure, group_size, advance_count (locked once matches
   exist; a "Regenerate" button unlocks after confirming a warning).
2. **Groups & seeding**: entries with a "Reshuffle" and per-slot "Swap"
   controls.
3. **Fixtures**: matches grouped by stage. Each match card exposes
   inline court + time inputs, an "Enter result" button, and (when
   `status='reported'`) a **Confirm** / **Reject** pair.
4. **Leaderboard preview**: identical to what players see, so the admin can
   sanity-check before publishing.

The existing "Edit entry" flow is unchanged.

## 11. Player UI

Under `/tournament`:

1. **Categories** section (already exists): unchanged.
2. **Your matches** (new): personal schedule with when/where and status.
   Report button on their own pending matches.
3. **Schedule** (new): full timetable per category, grouped by day and court.
4. **Leaderboard** (new): per-category standings table with qualifying badges
   and the knockout bracket rendered as a list of round columns.

The tournament placeholder page ("Something big is warming up…") stays as-is
when no tournament is published.

## 12. API surface (additions)

### Public / player

- `GET  /api/tournaments/:id/schedule` — matches, groups, leaderboards; safe
  for anyone signed in or not.
- `POST /api/tournaments/matches/:id/report` — body: `{ set1: [a,b], set2:
  [a,b], set3?: [a,b] }`. Auth: must be one of the entries.
- `DELETE /api/tournaments/matches/:id/report` — retract own report before
  admin confirms.

### Admin

- `PATCH /api/admin/tournaments/categories/:id/structure` — set
  `structure`, `groupSize`, `advanceCount` (only while no fixtures exist).
- `POST  /api/admin/tournaments/categories/:id/generate-groups` — creates
  groups + group matches; `?force=true` wipes existing.
- `POST  /api/admin/tournaments/categories/:id/generate-knockout` — creates
  knockout bracket from group standings (or fresh for `structure=ko`).
- `POST  /api/admin/tournaments/groups/:id/swap` — body: `{ regA, regB }`
  swaps two entries across groups.
- `PATCH /api/admin/tournaments/matches/:id` — court, scheduled_at, force
  winner, override scores.
- `POST  /api/admin/tournaments/matches/:id/confirm` — freezes result +
  advances.
- `POST  /api/admin/tournaments/matches/:id/reject` — clears scores.
- `POST  /api/admin/tournaments/matches/:id/result` — admin-only direct entry
  when no report exists.
- `POST  /api/admin/tournaments/categories/:id/reset` — wipes matches and
  groups for a full regenerate.

## 13. Reference: how established apps solve this

We're not cloning any of these, but they're worth reading before/after to
sanity-check our data model and UI choices.

- **Challonge** (`challonge.com`) — the classic community bracket generator.
  Good reference for **structure options** (round-robin, single-elim, double-
  elim, group stages) and their "auto-advance winner" mechanic.
- **Toornament** (`toornament.com`) — more polished, geared at esports and
  local sport clubs. Reference for **match reporting UI**, dispute flow, and
  per-match schedule editing.
- **Tournify** (`tournify.io`) — used by small badminton/tennis clubs.
  Reference for **court scheduling grid** and printable draw sheets.
- **Sportlyzer** — club management with schedules + leaderboards; good for
  the **standings-with-qualifying** presentation.
- **PlayTomic** / **Rankedin** — tennis/padel leagues. Reference for
  **tie-breaker order** (matches → sets → points is the near-universal choice
  we're adopting).
- **Wikipedia: Round-robin tournament** — has the classic Berger tables
  we'll use for k=3, k=4 pairings.

## 14. Data lifecycle

- Matches and groups are cascaded on tournament / category delete (already
  set up via `ON DELETE CASCADE`).
- The 14-day retention job (`cleanupOldRecords`) does **not** touch
  tournaments — tournaments are historical records worth keeping. If we want
  to trim them eventually, that's a separate admin action.
- Player deletion (`DELETE /admin/players/:id`) cascades through
  registrations and thence through matches (winner/entry references go NULL
  via `SET NULL`, keeping historical scoresheets intact).

## 15. Estimated implementation size

| Chunk                                    | Files touched | Rough LOC |
| ---------------------------------------- | ------------- | --------- |
| Schema + migrations                      | `server/db.js`               |  60 |
| Format enum expansion + `needsPartner`   | `server/index.js` + client   |  40 |
| Category config endpoints                | `server/index.js`            |  50 |
| Fixture generation logic + endpoints     | `server/index.js`            | 260 |
| Report / confirm / reject endpoints      | `server/index.js`            |  90 |
| Schedule + leaderboard read endpoint     | `server/index.js`            | 100 |
| Admin fixtures UI (tabs, grid, dialogs)  | `admin/tournaments.tsx`      | 500 |
| Player schedule + report + leaderboard   | `pages/tournament.tsx` (+ new component)  | 400 |
| Types                                     | `lib/api.ts`                 |  60 |
| **Total**                                | 6 files                     | **~1560** |

## 16. Does Render's free tier handle this?

Short answer: **yes for the workload, but the cold-start latency will be
annoying on tournament day.** Recommendation is a $7/mo starter plan while a
tournament is running, then back to free.

Long answer — the moving parts:

- **Web service (this app):** on Render's free plan the service **sleeps
  after ~15 min of inactivity** and takes ~30–60 s to wake on the next
  request. Once awake it comfortably handles a friends' club worth of
  traffic (dozens of concurrent users, small JSON payloads). 512 MB RAM /
  0.1 CPU is plenty for our SQL and JSON work.
- **Postgres:** we use **Neon**, not Render Postgres. Neon's free plan
  currently gives 0.5 GB storage and ~191 compute-hours/month, which is
  vast overkill for our schema — even a hundred tournaments with matches
  and scores is well under 100 MB.
- **Email (Resend):** free tier = 100 emails/day, 3 000/month. OTP-only
  usage stays well inside that. During a big sign-up wave (a new tournament
  publishes and 40 players log in the same evening) you'd send maybe 40
  emails — still nowhere near the limits.
- **Bandwidth:** Render free plan includes 100 GB/month egress. This app
  serves a small SPA bundle (~350 KB gzip today) plus small JSON — a
  tournament weekend won't dent it.
- **Storage:** we don't write to local disk; all persistence is on Neon and
  Resend, so the ephemeral filesystem on Render is fine.

**Where the free tier hurts:**

1. **Cold start.** During a tournament, the first person to open the
   schedule or report a score after a lull waits ~30 s. A cheap workaround is
   pinging `/api/health` from a free uptime monitor (e.g. UptimeRobot,
   BetterStack free tier) every 5 minutes to keep the service warm — that
   fits inside Render's 750 monthly hours if the service is always the only
   free web service on the account.
2. **No custom domain on the free plan** for some historical Render tiers
   (check the current dashboard — this has fluctuated). If we need
   `friends-club.cz` to point at Render, the starter plan is the safe path
   anyway.
3. **Autoscaling / concurrency** is not really a thing on free. If you ever
   run multiple tournaments simultaneously on the same day, you may want to
   pay for the starter plan.

**Suggested plan of action:**

- Ship on free.
- Set up a free uptime pinger to reduce cold starts to zero during working
  hours.
- The morning of a tournament, temporarily upgrade to Render starter
  ($7/mo, no cold starts, custom domain, more CPU/RAM). Downgrade after.
- Revisit only if storage on Neon crosses ~250 MB or Resend usage
  approaches the daily/monthly cap.
