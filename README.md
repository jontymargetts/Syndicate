# Syndicate

A small Next.js (App Router, TypeScript, Tailwind, Recharts) web app for the betting syndicate:
a read-only view of the tracker spreadsheet plus a bet queue for proposing, approving and recording bets.

## Status

- The spreadsheet is imported (`data/`): the dashboard, the Members page and a page per sheet are built from it.
- The dashboard figures come from the `TWOL (New)` sheet (weekly punts, banked, fines, summary cells), plus
  settled bets from the bet queue (see **How settled bets feed the figures**). The `TWOL (Old)` sheet is an earlier
  10-week snapshot and is not used in the totals.
- The workbook has **no per-bet stakes, odds, sports, markets or bet types**. Settled queue bets do carry stakes,
  odds and returns, so they give a real strike rate, but sport/market/bet-type breakdowns are still not available.
- Each member pays £5 a week: £2.50 is banked and £2.50 is staked on bets.

## Running locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm run lint`, `npm run start`.

Check the settlement and statistics rules (no database needed):

```bash
node --experimental-strip-types scripts/check-stats.mts
```

## Re-importing the spreadsheet

The app reads only the JSON files in `data/`. The spreadsheet itself is never committed (`*.xlsx` is git-ignored).

```bash
pip install openpyxl
python3 scripts/import-xlsx.py path/to/Copy_of_TWICHOL.xlsx
git add data && git commit -m "Update syndicate data" && git push
```

The script writes one `data/<sheet>.json` per sheet plus `data/index.json`. Each sheet JSON has `tables`
(title, cell range, columns, rows). The `TWOL (New)` tracker is parsed by its labels (Punts, Fines Paid, Banked,
Leaderboard Source, Week total), not fixed row numbers. The dashboard computes its figures in `lib/stats.ts`
(pure functions, no file access), and the dashboard's checks compare them against the sheet's own totals.

Privacy: columns whose headers look like personal or banking data (bank/sort code/account numbers, phone,
e-mail, address, postcode, date of birth, passport, NI number, passwords, card details) are **dropped** from the
JSON and listed under `omittedColumns` in `data/index.json`. Edit `SENSITIVE_HEADER` in
`scripts/import-xlsx.py` to change this.

## Deploying to Vercel

1. Push this repository to GitHub (`jontymargetts/syndicate`).
2. In the Vercel dashboard choose **Add New > Project**, import the GitHub repo.
3. Keep the detected settings (Framework: Next.js, build command `next build`).
4. Add the database (see **Shared bet queue database** below). This adds `DATABASE_URL`.
5. Deploy. Every push to the connected branch redeploys.

## Shared bet queue database (Neon Postgres)

The bet queue is stored in a Postgres database, so every member sees the same queue. The app talks to it only
from the server (`app/api/bets/*`), using the `DATABASE_URL` environment variable.

### Setup on Vercel (free Neon database)

1. In the Vercel project, go to **Storage > Create Database > Neon** (Marketplace), choose the **Free** plan and
   the **eu-west-2 (London)** region, and connect it to all environments (Production, Preview, Development).
2. Confirm that `DATABASE_URL` now appears under **Settings > Environment Variables**. Redeploy.
3. The `bets` table is created automatically on the first API request. You can also run the setup manually
   (see below).

### Setup locally

```bash
# .env.local (git-ignored)
DATABASE_URL=postgresql://...   # copy from Vercel or the Neon dashboard
npm run db:setup                # creates the bets table and indexes (idempotent)
npm run dev
```

`db/schema.sql` is the schema. `scripts/db-setup.mjs` applies it. The API also applies the same statements on
first use, so `npm run db:setup` is optional.

### Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes, for a shared queue | Neon/Postgres connection string. Falls back to `POSTGRES_URL` if that is set instead. |

If no database variable is set, the API returns `503` and the bet queue falls back to **this browser's
localStorage**. The page then shows "Shared database not connected — queue saved in this browser only".

### API

- `GET /api/bets`: list bets, newest first.
- `POST /api/bets`: propose a bet (`event`, `selection` required; `market`, `proposedBy`, `notes` optional;
  `odds` > 1 and `stake` > 0 required).
- `PATCH /api/bets/:id`: change status along the path proposed → approved → placed → settled (won/lost/void),
  with `placedOdds`, `placedStake`, `placedAt`, `settledAt`, `returns`. Invalid transitions return `409`; invalid
  returns return `400`.
- Odds may be decimal (`2.50`) or fractional (`5/2`, stored as 3.50) in both `POST` and `PATCH`.

### Settling and returns

`returns` is the total paid back, **stake included**. Profit is returns minus the placed stake.

| Settle as | Returns when not given | Rules when given |
| --- | --- | --- |
| Won | placed stake × placed odds | 0 up to stake × odds (for each-way or cash-out) |
| Lost | 0 | must be exactly 0 |
| Void | placed stake (refunded) | must be exactly the placed stake |

The server computes returns in `PATCH /api/bets/:id` (`updateBet` in `lib/db.ts`, rules in `resolveReturns` in
`lib/bets.ts`). The queue's **Won / Lost / Void** buttons settle in one click. Typing a value in
**Edit returns** overrides the automatic figure. Settled bets saved before returns were stored are shown with the
automatic figure.

## How settled bets feed the figures

Settled queue bets (won, lost or void) are read from the database on each request by the dashboard and the Members
page. Nothing needs retyping. If no database is configured, or the query fails, both pages silently show the
spreadsheet figures only (the failure is logged on the server).

**Cut-off.** A queue bet is counted only if it was settled after the spreadsheet's last week, so nothing is counted
twice. The cut-off is `Starting Date + 7 × weeks played` (computed in `queueCutoff` in `lib/stats.ts`). It is the
first instant after the spreadsheet's last week. The dashboard shows the last day covered by the spreadsheet, as
"Includes queue bets settled after …". With the current import (start 21 Jan 2026, 39 weeks) the cut-off is
**21 Oct 2026 00:00 UTC**, so the dashboard reads "settled after 20 Oct 2026". Bets settled before the cut-off are
ignored.

**Re-importing moves the cut-off forward.** When you import a newer spreadsheet, its extra weeks are counted from
the sheet and the cut-off moves to the end of its last week. Queue bets settled before the new cut-off then stop
being counted separately. So re-import only once the spreadsheet records those weeks' returns.

**Formula.** Per queue bet, with stake `s` and returns `r`:

- Staked += s, Punts (returns) += r, bet P&L += r − s, ROI = bet P&L / staked.
- Pot += r − s, so pot = banked + punts + fines + interest − queue stakes. This keeps the sheet's identity:
  overall P&L = pot − paid in = bet P&L + fines + interest.
- Average pot per week and the projected target date use the spreadsheet's own pot and weeks. Progress to target uses
  the full pot.
- The cumulative P&L chart adds one point per queue bet in settled order. The monthly chart groups queue bets by the
  month they settled in.

**Limitation.** Weekly payments after the cut-off are not in `Overall paid` until the spreadsheet is re-imported. The
queue stakes come out of the pot now, but the payments they were funded from do not go in until then, so the pot
shows less than the real money held. Bet P&L is unaffected.

**Members.** Each settled queue bet's returns are credited to its `proposed by` name, matched case-insensitively
(ignoring surrounding spaces) to a member's name on the sheet. Anyone else goes under **Other**. The Members page
shows each member's queue returns and a table per proposer.

**Strike rate.** Queue strike rate = won / (won + lost). Void bets are not counted. It appears once a queue bet has
won or lost. The week-based figure stays labelled as a proxy.
- There is **no DELETE endpoint** by design. The queue page polls `GET /api/bets` every 10 seconds.

### Security: no login yet

**There is no login.** Anyone with the link can propose bets and change their status (approve, mark placed,
settle). Treat the site URL as private, and do not share it publicly. Access control (who may approve or settle)
should be added before the syndicate relies on it. Until then, the leader's approval is by convention only.

## Bet Queue

Statuses: Proposed → Approved → Placed → Settled (Won / Lost / Void). The queue is shared through the database
described above. Without a database it works per browser only (see the banner on the page).

Bets are placed **manually** by the leader. The "Open bet365" button is a plain outbound link to
https://www.bet365.com. The app does not log in to, scrape, or automate bet365 in any way.

Bet statuses: Proposed → Approved → Placed → Settled (Won / Lost / Void).

## Project layout

```
app/
  layout.tsx          root layout + nav bar
  page.tsx            dashboard: KPIs, cumulative P&L, monthly and member breakdowns, checks
  data/[slug]/page.tsx  one page per spreadsheet sheet (sortable, searchable table)
  bets/page.tsx       bet queue page
components/
  NavBar.tsx          navigation (dark mode follows the OS setting)
  CumulativeChart.tsx, BarChart.tsx   Recharts charts (single series, dark mode via chartTheme.ts)
  DataTable.tsx       client-side sortable/searchable table
  BetQueue.tsx        bet queue UI (API-backed, localStorage fallback)
app/api/bets/         bet queue API (GET/POST, PATCH by id)
db/
  schema.sql          bets table and indexes
lib/
  bets.ts             bet types, status flow, odds parsing, settlement returns (client-safe, pure)
  db.ts               server-only database access, validation, settled queue bets for the pages
  data.ts             server-side loader for data/*.json
  stats.ts            pure statistics: queue cut-off, queue bets, totals, series, members, reconciliation
scripts/check-stats.mts  checks the settlement and statistics rules with sample bets
scripts/import-xlsx.py  spreadsheet -> data/*.json converter
data/                 generated JSON (committed)
```
