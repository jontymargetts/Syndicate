import BarChartView from "@/components/BarChart";
import { fetchSettledQueueBets } from "@/lib/db";
import { getIndex, getSheet } from "@/lib/data";
import {
  OTHER_PROPOSER,
  computeStats,
  formatDate,
  formatGBP,
  formatPct,
  includedQueueBets,
  lastSpreadsheetDay,
  memberStats,
  parseTracker,
  queueByProposer,
} from "@/lib/stats";

export const metadata = { title: "Members - Syndicate" };
// Queue bets are read on every request, so returns follow the queue without a redeploy.
export const dynamic = "force-dynamic";

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${formatGBP(n)}`;
}

export default async function MembersPage() {
  const index = getIndex();
  const trackerMeta = index.sheets.find((s) => s.name === "TWOL (New)");
  const tracker = parseTracker(trackerMeta ? getSheet(trackerMeta.slug) : null);
  const sheetStats = tracker ? computeStats(tracker) : null;

  if (!tracker || !sheetStats) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
        <p className="font-medium text-slate-800 dark:text-slate-200">No member data imported yet.</p>
        <p className="mt-2">Run the importer (see the README) and commit the generated files in data/.</p>
      </section>
    );
  }

  // Queue bets: null when no database is configured or the query fails. Spreadsheet figures are shown alone then.
  const settledQueue = await fetchSettledQueueBets();
  const connected = settledQueue !== null;
  const queue = settledQueue ? includedQueueBets(tracker, settledQueue) : [];
  const stats = computeStats(tracker, queue) ?? sheetStats;
  const rows = memberStats(tracker, stats, queue);
  const proposers = queueByProposer(tracker, queue);
  const other = proposers.find((p) => p.name === OTHER_PROPOSER);
  const cutoffDay = lastSpreadsheetDay(tracker);

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Members</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          {stats.members} members over {stats.weeks} weeks. Figures from the TWOL (New) sheet
          {connected && cutoffDay && <> and queue bets settled after {formatDate(cutoffDay)}</>}.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Total punts (returns) by member</h2>
        <BarChartView
          orientation="horizontal"
          height={Math.max(220, (rows.length + (other ? 1 : 0)) * 28)}
          data={[
            ...rows.map((m) => ({
              label: m.name,
              value: Math.round(m.punts * 100) / 100,
              detail: `${formatPct(m.puntsShare)} of all punts`,
            })),
            ...(other
              ? [
                  {
                    label: OTHER_PROPOSER,
                    value: Math.round(other.returns * 100) / 100,
                    detail: `${formatPct(stats.punts ? other.returns / stats.punts : 0)} of all punts`,
                  },
                ]
              : []),
          ]}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Contributions and P&amp;L</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                {[
                  "Member",
                  "Punts",
                  "Of which queue",
                  "Share of punts",
                  "Weeks with a return",
                  "Best punt",
                  "Banked",
                  "Fines paid",
                  "Overdue",
                  "Paid in (share)",
                  "Pot (share)",
                  "P&L (equal share)",
                ].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
              {rows.map((m) => (
                <tr key={m.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900 dark:text-white">{m.name}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.punts)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.queueReturns)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatPct(m.puntsShare)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{m.weeksWithReturn}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.bestPunt)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.banked)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.fines)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.overdue)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.paidIn)}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(m.potShare)}</td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 font-medium tabular-nums ${
                      m.pnl >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                    }`}
                  >
                    {signed(m.pnl)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>
            Paid in and pot are split equally: every member pays the same weekly amount, so each share is the group total
            divided by {stats.members}. The equal-share P&amp;L is therefore the same for everyone ({signed(rows[0]?.pnl ?? 0)}).
          </li>
          <li>
            The member-specific figures are punts (returns brought in), fines and overdue. Fines and overdue are totals with
            no dates in the sheet.
          </li>
          <li>Sorted by punts, highest first. Names are the first names used on the sheet.</li>
        </ul>
      </section>

      {connected && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-slate-900 dark:text-white">Queue bets by proposer</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
              <thead className="bg-slate-50 dark:bg-slate-800">
                <tr>
                  {["Proposed by", "Settled bets", "Won", "Lost", "Void", "Staked", "Returns", "Bet P&L"].map((h) => (
                    <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                {proposers.map((p) => (
                  <tr key={p.name} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900 dark:text-white">{p.name}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.bets}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.won}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.lost}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.void}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(p.staked)}</td>
                    <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(p.returns)}</td>
                    <td
                      className={`whitespace-nowrap px-3 py-2 font-medium tabular-nums ${
                        p.returns - p.staked >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-700 dark:text-rose-400"
                      }`}
                    >
                      {signed(p.returns - p.staked)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Each settled queue bet is credited to the person who proposed it. Names are matched to the member names on the
            sheet, ignoring case and spaces. Anyone else goes under Other. Only bets settled after the spreadsheet&apos;s last
            week are included.
          </p>
        </section>
      )}
    </div>
  );
}
