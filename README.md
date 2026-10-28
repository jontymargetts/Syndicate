# Syndicate

A small Next.js (App Router, TypeScript, Tailwind, Recharts) web app for the betting syndicate: a read-only view of the
tracker spreadsheet, plus a bet queue for proposing, approving and recording bets, and pages for weekly payments,
results entered by hand, and fines.

## Status

- The spreadsheet is imported (`data/`): the dashboard, the Members page and a page per sheet are built from it.
- The dashboard figures come from the `TWOL (New)` sheet (weekly punts, banked, fines, summary cells), plus everything
  recorded in the database after the sheet ends (see **How the figures are worked out**). The `TWOL (Old)` sheet is an
  earlier 10-week snapshot and is not used in the totals.
- The workbook has **no per-bet stakes, odds, sports, markets or bet types**. Bets and results recorded in the app do
  carry stakes and returns, so they give a real strike rate, but sport/market/bet-type breakdowns are not available.
- Each member pays £5 a week by standing order: £2.50 is banked and £2.50 is the stake for bets.

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

**Re-import moves the cut-off forward.** When you import a newer spreadsheet, its extra weeks are counted from the sheet
and the cut-off moves to the end of its last week. Anything recorded in the database before the new cut-off (payments,
bets, results, fines) then stops being counted separately, so re-import only once the spreadsheet records those weeks.

Privacy: columns whose headers look like personal or banking data (bank/sort code/account numbers, phone,
e-mail, address, postcode, date of birth, passport, NI number, passwords, card details) are **dropped** from the
JSON and listed under `omittedColumns` in `data/index.json`. Edit `SENSITIVE_HEADER` in
`scripts/import-xlsx.py` to change this.

## Deploying to Vercel

1. Push this repository to GitHub (`jontymargetts/syndicate`).
2. In the Vercel dashboard choose **Add New > Project**, import the GitHub repo.
3. Keep the detected settings (Framework: Next.js, build command `next build`).
4. Add the database (see **Shared database** below). This adds `DATABASE_URL`.
5. Deploy. Every push to the connected branch redeploys.

## Shared database (Neon Postgres)

The bet queue, payments, results and fines are stored in a Postgres database, so every member sees the same data. The
app talks to it only from the server (`app/api/*` and the server pages), using the `DATABASE_URL` environment variable.

### Setup on Vercel (free Neon database)

1. In the Vercel project, go to **Storage > Create Database > Neon** (Marketplace), choose the **Free** plan and
   the **eu-west-2 (London)** region, and connect it to all environments (Production, Preview, Development).
2. Confirm that `DATABASE_URL` now appears under **Settings > Environment Variables**. Redeploy.
3. The tables (`bets`, `payments`, `results`, `fines`) are created automatically on the first request. You can also run
   the setup manually (see below).

### Setup locally

```bash
# .env.local (git-ignored)
DATABASE_URL=postgresql://...   # copy from Vercel or the Neon dashboard
npm run db:setup                # creates the tables and indexes (idempotent)
npm run dev
```

`db/schema.sql` is the schema. `scripts/db-setup.mjs` applies it. The app applies the same statements (the bootstrap in
`lib/db.ts`) on first use, so `npm run db:setup` is optional.

### Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes, for a shared database | Neon/Postgres connection string. Falls back to `POSTGRES_URL` if that is set instead. |

**Without a database** the app still shows the spreadsheet figures and the pages load. The Bet Queue then saves in this
browser only ("Shared database not connected — queue saved in this browser only"). Payments, Results and Fines show a
"Database not connected" message and cannot save anything. The dashboard and Members page show spreadsheet figures only,
without anything recorded after the sheet ends (including automatic payments).

### Security: no login yet

**There is no login.** Anyone with the link can propose bets, change their status, delete bets, record payments and
results, and add or delete fines. Treat the site URL as private, and do not share it publicly. Access control (who may
approve, settle or record money) should be added before the syndicate relies on it. Until then, the leader's approval
is by convention only.

## Bet Queue

Statuses: Proposed → Approved → Placed → Settled (Won / Lost / Void). The queue is shared through the database
described above. Without a database it works per browser only (see the banner on the page).

Bets are placed **manually** by the leader. The "Open bet365" button is a plain outbound link to
https://www.bet365.com. The app does not log in to, scrape, or automate bet365 in any way.

- The propose form and the "Mark as placed" form pre-fill the stake with **£2.50**. Change it if needed.
- **Delete** on every bet removes it after a confirmation. A deleted bet drops out of all figures.

### Settling and returns

`returns` is the total paid back, **stake included**. Profit is returns minus the placed stake.

| Settle as | Returns when not given | Rules when given |
| --- | --- | --- |
| Won | placed stake × placed odds | 0 up to stake × odds (for each-way or cash-out) |
| Lost | 0 | must be exactly 0 |
| Void | placed stake (refunded) | must be exactly the placed stake |

The server computes returns in `PATCH /api/bets/:id` (`updateBet` in `lib/db.ts`, rules in `resolveReturns` in
`lib/bets.ts`). The queue's **Won / Lost / Void** buttons settle in one click. Typing a value in **Edit returns**
overrides the automatic figure.

## Payments (`/payments`)

Payments are automatic (standing orders). From the cut-off onwards, **every member counts as paid for every week up to
and including the current week**. Future weeks are never counted.

- Only **exceptions** are stored, in the `payments` table: `member`, `week_number`, `paid` (boolean), `note`,
  `updated_at`, unique on (member, week). A member-week with **no row is paid**.
- The grid toggles a cell: clicking a paid cell records a missed payment (`paid = false`), clicking a missed cell
  re-ticks it (`paid = true`, which keeps the record). Notes are kept when a cell is toggled. The page also shows
  totals per member (paid and missed weeks and amounts).
- Each paid member-week adds **£5** to paid in, **£2.50** to banked and **£2.50** to staked (see the money model below).

## Results (`/results`)

For bets not placed through the queue. Each result is credited to the member it is entered for, or to **Syndicate**
(which goes under "Other" in the member figures).

- **Form:** date (default today), member (the 12 members or Syndicate), description (optional), stake (default £2.50),
  returns (winnings **including** the stake; 0 for a loss), notes (optional).
- **CSV upload:** columns, in this order: `date,member,description,stake,returns`

  ```csv
  date,member,description,stake,returns
  2026-10-24,Jonty,Arsenal to win @ 3.00,2.50,7.50
  2026-10-25,Syndicate,Accumulator (lost),2.50,0
  ```

  - `date` is `YYYY-MM-DD` (a real calendar date, not more than two days ahead). `member` is one of the names on the
    sheet or `Syndicate`, matched ignoring case. `stake` may be blank (it then means 2.50). `returns` is required.
    Quoted fields may contain commas. The header may be in any order, and extra columns are ignored.
  - The file is parsed in the browser and every row is checked. Rows with errors are highlighted. Nothing is saved
    until every row is valid, and then all rows are saved in one go (up to 500 rows).
  - A template is at `/results-template.csv` (link on the page).
- **Outcome:** won = returns above the stake, void = returns equal to the stake, lost = returns below it.
- A result dated on or after the cut-off feeds returns, member figures, the charts and the strike rate, in the same way
  as a settled queue bet. Results dated before the cut-off are shown on the page but not counted.

## Fines (`/fines`)

- Add a fine: member, amount, reason (optional), date (default today).
- **Mark as paid** records `paid_at`. **Mark unpaid** clears it. **Delete** removes the fine (after a confirmation).
- A fine marked paid **after the cut-off** adds to fines paid and to the pot. An **unpaid** fine **dated on or after the
  cut-off** is overdue (shown, but not in the pot). Fines from before the cut-off are already in the spreadsheet and are
  not counted here.
- The page shows the unpaid total and unpaid fines by member. The Members page shows fines paid and overdue per member.

## How the figures are worked out

**Cut-off.** The cut-off is `Starting Date + 7 × weeks played` (computed in `cutoffDate` in `lib/stats.ts`). It is the
first instant after the spreadsheet's last week. With the current import (start 21 Jan 2026, 39 weeks) it is
**21 Oct 2026 00:00 UTC**. Everything recorded in the database counts only from the cut-off: bets and results settled
on or after it, payments for weeks that start on or after it, and fines paid on or after it (or unpaid and dated on
or after it). Anything earlier is ignored, so nothing is counted twice.

**Weeks.** Week *n* starts on the starting date plus 7 × (*n* − 1) days. The weeks counted after the cut-off run from
the first week after the sheet up to the **current week** (`postCutoffWeeks` in `lib/stats.ts`). Future weeks are never
counted.

**Money model.** Each paid member-week after the cut-off brings in £5, of which £2.50 is banked and £2.50 is staked.
This is the sheet's own convention (staked = paid in minus banked), extended to the new weeks.

- **Paid in** = sheet paid in + £5 × paid member-weeks.
- **Banked** = sheet banked + £2.50 × paid member-weeks.
- **Staked** = sheet staked (paid in minus banked) + £2.50 × paid member-weeks. This is the **weekly stake allocation**.
  Bet stakes do not add to it, because the bets are paid for from that allocation.
- **Punts** = sheet punts + returns of settled queue bets and results after the cut-off.
- **Bet P&L** = punts − staked.
- **Pot** = banked + punts + fines paid + interest. This is the sheet's own "Overall" formula. Equivalently, pot = paid
  in − staked + punts + fines paid + interest.
- **Overall P&L** = pot − paid in = bet P&L + fines paid + interest.

**Avoiding double counting.** Each week's £2.50 is counted once, when the payment comes in, as the stake allocation. A
bet's stake is paid for from that allocation, so it is not taken out of the pot a second time. Only the bet's **returns**
move money: they add to punts. Stakes placed on settled bets and results are shown separately ("Stakes placed"). They
can be more or less than the weekly allocation; the leader can check that figure against staked.

**Missed payments.** A missed payment removes its £5 from paid in and its £2.50 from the stake allocation (so it is not
staked), and that member's paid in share falls. Re-ticking it puts both back.

**Average pot per week and the projected date** use the spreadsheet's own pot and weeks (the sheet's pace). Progress to
target uses the full pot.

**Charts.** The cumulative bet P&L line has one point per sheet week, then one step down per week's stake allocation and
one step up per settled bet or result, in date order. It ends at the bet P&L. The monthly chart groups weeks by their
start month, and bets and results by the month they settled in.

**Members.** The pot is split equally between members. Paid in is the equal share of the sheet's paid in, plus each
member's own payments since the cut-off. Each settled bet or result is credited to the person who proposed it or
entered it, matched to a sheet name ignoring case and spaces. Anyone else, and "Syndicate", go under **Other**.

**Strike rate.** Settled bets (queue and results) = won / (won + lost). Void is not counted. The week-based figure stays
labelled as a proxy.

**Limitation.** The sheet has no bet-level data, so per-bet and per-sport figures exist only for bets recorded in the app.

## Checks

`scripts/check-stats.mts` checks the settlement, payments, results, fines and CSV rules with sample data. It includes a
baseline check: with no post-cut-off weeks and no database rows the figures equal the spreadsheet exactly (pot £2,827.38,
punts £960.16, bet P&L −£209.84, staked £1,170).

```bash
node --experimental-strip-types scripts/check-stats.mts
```

## API

All routes return JSON. Errors: `400` validation (with `message`), `404` not found, `503` database not configured or
the spreadsheet data missing, `500` database error.

- `GET /api/bets`, `POST /api/bets` (propose: `event`, `selection`, `odds`, `stake` required; `market`, `proposedBy`,
  `notes` optional). Odds may be decimal (`2.50`) or fractional (`5/2`, stored as 3.50).
- `PATCH /api/bets/:id`: change status along proposed → approved → placed → settled, with `placedOdds`, `placedStake`,
  `placedAt`, `settledAt`, `returns`. Invalid transitions return `409`; invalid returns return `400`.
- `DELETE /api/bets/:id`: delete a bet.
- `GET /api/payments`, `POST /api/payments` (`member`, `weekNumber`, `paid`, `note` optional). Only weeks after the cut-off,
  up to the current week, are accepted.
- `GET /api/results`, `POST /api/results` (one result as an object, or `{ "rows": [...] }` for up to 500, all or nothing),
  `DELETE /api/results/:id`.
- `GET /api/fines`, `POST /api/fines` (`member`, `amount`, `reason`, `date`), `PATCH /api/fines/:id` (`{ "paid": true | false }`),
  `DELETE /api/fines/:id`.

Amounts are in pounds, 0 or more, at most 2 decimal places. Dates are `YYYY-MM-DD`. Members are checked against the sheet.

## Project layout

```
app/
  layout.tsx              root layout + nav bar
  page.tsx                dashboard: KPIs, cumulative P&L, monthly and member breakdowns, checks
  members/page.tsx        members: punts, paid in, pot share, fines and overdue, settled bets by proposer
  bets/page.tsx           bet queue page
  payments/page.tsx       weekly payments grid (missed payments) and per-member totals
  results/page.tsx        results entered by hand, CSV upload
  fines/page.tsx          fines: add, mark paid or unpaid, delete
  data/[slug]/page.tsx    one page per spreadsheet sheet (sortable, searchable table)
  api/                    route handlers: bets, payments, results, fines
components/
  NavBar.tsx              navigation (dark mode follows the OS setting)
  CumulativeChart.tsx, BarChart.tsx   Recharts charts (single series, dark mode via chartTheme.ts)
  DataTable.tsx           client-side sortable/searchable table
  BetQueue.tsx            bet queue UI (API-backed, localStorage fallback)
  PaymentGrid.tsx         payments grid (toggles missed payments)
  ResultsManager.tsx      results form, CSV upload preview, list
  FinesManager.tsx        fines form, list, mark paid or unpaid
db/
  schema.sql              bets, payments, results and fines tables and indexes
lib/
  bets.ts                 bet types, status flow, odds parsing, settlement returns (client-safe, pure)
  entries.ts              validation for results, fines and payments; results CSV parsing (client-safe, pure)
  stats.ts                pure statistics: cut-off, weeks, ledger, totals, series, members, reconciliation
  db.ts                   server-only: connection, schema bootstrap, bets queries and validation
  records.ts              server-only: reads and writes for payments, results, fines and the figures' inputs
  tracker.ts              server-only: loads the TWOL (New) tracker from data/
  data.ts                 server-side loader for data/*.json
scripts/check-stats.mts   checks the rules with sample data (no database needed)
scripts/import-xlsx.py    spreadsheet -> data/*.json converter
data/                     generated JSON (committed)
public/results-template.csv  CSV template for results
```

## Security and privacy notes

- The spreadsheet itself is never committed. The JSON in `data/` holds only the sheet's figures, with personal columns removed.
- All database queries are parameterised. Input is validated on the server, not only in the browser.
