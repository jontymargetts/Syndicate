# Syndicate

A small Next.js (App Router, TypeScript, Tailwind, Recharts) web app for the betting syndicate:
a read-only view of the tracker spreadsheet plus a bet queue for proposing, approving and recording bets.

## Status

- **Spreadsheet import is not yet populated.** The uploaded `Copy_of_TWICHOL.xlsx` is an
  encrypted / rights-managed file (header `MSMAMARPCRYPT`, AES encrypted), so it cannot be read.
  `data/index.json` is an empty placeholder until a readable copy is imported.
  To fix: open the file in Excel, remove the protection (File > Info > Protect Workbook / Restrict Access),
  Save As a new `.xlsx`, then follow "Re-importing the spreadsheet" below.
- The dashboard KPIs and charts (P&L over time, breakdowns) and the members page are **not yet built**.
  They depend on the real column names, which can only be confirmed after import.

## Running locally

```bash
npm install
npm run dev        # http://localhost:3000
```

Other scripts: `npm run build`, `npm run lint`, `npm run start`.

## Re-importing the spreadsheet

The app reads only the JSON files in `data/`. The spreadsheet itself is never committed (`*.xlsx` is git-ignored).

```bash
pip install openpyxl
python3 scripts/import-xlsx.py path/to/Copy_of_TWICHOL.xlsx
git add data && git commit -m "Update syndicate data" && git push
```

The script writes one `data/<sheet>.json` per sheet plus `data/index.json`.

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
  with `placedOdds`, `placedStake`, `placedAt`, `settledAt`, `returns`. Invalid transitions return `409`.
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
  page.tsx            dashboard (sheet overview; KPIs pending import)
  data/[slug]/page.tsx  one page per spreadsheet sheet (sortable, searchable table)
  bets/page.tsx       bet queue page
components/
  NavBar.tsx          navigation (dark mode follows the OS setting)
  DataTable.tsx       client-side sortable/searchable table
  BetQueue.tsx        bet queue UI (API-backed, localStorage fallback)
app/api/bets/         bet queue API (GET/POST, PATCH by id)
db/
  schema.sql          bets table and indexes
lib/
  bets.ts             bet types and pure helpers (client-safe)
  db.ts               server-only database access and validation
  data.ts             server-side loader for data/*.json
  bets.ts             bet types, status flow, copy-to-clipboard text
scripts/import-xlsx.py  spreadsheet -> data/*.json converter
data/                 generated JSON (committed)
```
