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
3. Keep the detected settings (Framework: Next.js, build command `next build`). No environment variables are needed.
4. Deploy. Every push to the connected branch redeploys.

## Bet Queue: storage and the shared-queue limitation

The queue lives in **`localStorage`** in the browser (`lib/bets.ts`, `components/BetQueue.tsx`).
That means:

- It works for one person on one browser.
- It is **not shared**. Each member's device has its own queue, so the leader will not see proposals made elsewhere.

For a shared queue, add a database (for example Vercel Postgres, Supabase, or Vercel KV/Upstash), create API
routes under `app/api/bets/` for list/create/update/delete, and replace `loadBets` / `saveBets` in
`components/BetQueue.tsx` with `fetch` calls. Access control (who may approve/settle) is also needed then; the
current page has none.

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
  BetQueue.tsx        bet queue UI (localStorage-backed)
lib/
  data.ts             server-side loader for data/*.json
  bets.ts             bet types, status flow, copy-to-clipboard text
scripts/import-xlsx.py  spreadsheet -> data/*.json converter
data/                 generated JSON (committed)
```
