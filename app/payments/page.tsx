import PaymentGrid, { type GridWeek } from "@/components/PaymentGrid";
import { fetchTable, listPayments } from "@/lib/records";
import { loadTracker } from "@/lib/tracker";
import {
  WEEKLY_BANKED,
  WEEKLY_PAYMENT,
  WEEKLY_STAKE,
  buildLedger,
  cutoffDate,
  formatDate,
  formatGBP,
  postCutoffWeeks,
  weekStart,
} from "@/lib/stats";

export const metadata = { title: "Payments | Syndicate" };
// Payments are read on every request, so the grid follows the database without a redeploy.
export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const tracker = loadTracker();
  if (!tracker) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
        <p className="font-medium text-slate-800 dark:text-slate-200">No tracker data imported.</p>
        <p className="mt-2">Run the importer (see the README) and commit the generated files in data/.</p>
      </section>
    );
  }

  const now = new Date();
  const weeks = postCutoffWeeks(tracker, now);
  const payments = await fetchTable(listPayments);
  const connected = payments !== null;
  const exceptions = (payments ?? []).map(({ member, weekNumber, paid, note }) => ({ member, weekNumber, paid, note }));
  const ledger = buildLedger(tracker, now, { bets: [], payments: exceptions, fines: [] });
  const gridWeeks: GridWeek[] = weeks.map((w) => ({ week: w, start: formatDate(weekStart(tracker, w)) }));
  const cutoff = cutoffDate(tracker);

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Payments</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Payments are automatic (standing orders): every member is counted as paid for every week from the cut-off
          {cutoff && <> ({formatDate(cutoff)})</>} up to the current week. Only missed payments are stored. Untick a week if a
          payment did not come through, and tick it again when it arrives. Future weeks are not shown.
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Each paid member-week adds {formatGBP(WEEKLY_PAYMENT)} to paid in, {formatGBP(WEEKLY_BANKED)} to banked and{" "}
          {formatGBP(WEEKLY_STAKE)} to staked. Stakes on bets are paid for from that money.
        </p>
      </section>

      {!connected && (
        <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
          Database not connected: missed payments cannot be recorded, and the figures show the spreadsheet only.
        </p>
      )}

      {weeks.length > 0 && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Weeks {weeks[0]} to {weeks.at(-1)} ({weeks.length} so far). Paid member-weeks: {ledger.paidMemberWeeks} of{" "}
          {ledger.payments.length * weeks.length}. Stake allocated: {formatGBP(ledger.allocations.reduce((s, a) => s + a.amount, 0))}.
        </p>
      )}

      <PaymentGrid members={tracker.members.map((m) => m.name)} weeks={gridWeeks} exceptions={exceptions} connected={connected} />

      {connected && exceptions.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-slate-900 dark:text-white">Stored payment records</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm dark:divide-slate-800 dark:border-slate-700 dark:bg-slate-900">
            {(payments ?? [])
              .slice()
              .sort((a, b) => b.weekNumber - a.weekNumber || a.member.localeCompare(b.member))
              .map((p) => (
                <li key={`${p.member}-${p.weekNumber}`} className="flex flex-wrap justify-between gap-2 px-4 py-2">
                  <span>
                    {p.member}, week {p.weekNumber}: {p.paid ? "re-ticked as paid" : "missed"}
                  </span>
                  <span className="text-slate-500 dark:text-slate-400">{p.note || "no note"}</span>
                </li>
              ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-900 dark:text-white">Per member</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Totals for the weeks counted so far. A missed week lowers that member&apos;s paid in and is not counted in the pot.
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
            <thead className="bg-slate-50 dark:bg-slate-800">
              <tr>
                {["Member", "Paid weeks", "Missed weeks", "Paid in (after cut-off)"].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
              {ledger.payments.map((p) => (
                <tr key={p.member}>
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900 dark:text-white">{p.member}</td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{p.paidWeeks}</td>
                  <td className={`whitespace-nowrap px-3 py-2 tabular-nums ${p.missedWeeks ? "font-medium text-rose-700 dark:text-rose-400" : ""}`}>
                    {p.missedWeeks}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(p.paidAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
