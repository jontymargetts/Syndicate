import Link from "next/link";
import BarChartView from "@/components/BarChart";
import CumulativeChart from "@/components/CumulativeChart";
import { getIndex, getSheet } from "@/lib/data";
import {
  computeStats,
  formatDate,
  formatGBP,
  formatPct,
  memberStats,
  monthlySeries,
  parseTracker,
  reconcile,
  weeklySeries,
} from "@/lib/stats";

function signed(n: number) {
  return `${n > 0 ? "+" : ""}${formatGBP(n)}`;
}

function Tile({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "pos" | "neg" }) {
  const valueClass =
    tone === "pos"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "neg"
        ? "text-rose-700 dark:text-rose-400"
        : "text-slate-900 dark:text-white";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${valueClass}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{note}</p>}
    </div>
  );
}

function Panel({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-lg font-medium text-slate-900 dark:text-white">{title}</h2>
      {children}
    </section>
  );
}

function TableTwin({ summary, head, rows }: { summary: string; head: string[]; rows: (string | number)[][] }) {
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white">
        {summary}
      </summary>
      <div className="mt-2 overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
        <table className="min-w-full divide-y divide-slate-200 text-xs dark:divide-slate-700">
          <thead className="bg-slate-50 dark:bg-slate-800">
            <tr>
              {head.map((h) => (
                <th key={h} className="whitespace-nowrap px-2 py-1.5 text-left font-medium text-slate-600 dark:text-slate-300">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j} className="whitespace-nowrap px-2 py-1.5 tabular-nums text-slate-700 dark:text-slate-200">
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export default function DashboardPage() {
  const index = getIndex();
  const trackerMeta = index.sheets.find((s) => s.name === "TWOL (New)");
  const tracker = parseTracker(trackerMeta ? getSheet(trackerMeta.slug) : null);
  const stats = tracker ? computeStats(tracker) : null;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Dashboard</h1>
        {index.importedAt && (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Data from {index.source} imported {new Date(index.importedAt).toLocaleString("en-GB")}
          </p>
        )}
      </section>

      {!tracker || !stats ? (
        <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <p className="font-medium text-slate-800 dark:text-slate-200">No tracker data imported.</p>
          <p className="mt-2">
            Run <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">python3 scripts/import-xlsx.py path/to/file.xlsx</code>{" "}
            and commit the generated files in <code>data/</code>. See the README for details.
          </p>
        </section>
      ) : (
        <Dashboard tracker={tracker} stats={stats} />
      )}

      <section>
        <Link
          href="/bets"
          className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Open the Bet Queue
        </Link>
      </section>
    </div>
  );
}

// Split out so the stats-dependent markup is only built when there is data.
function Dashboard({ tracker, stats: s }: { tracker: NonNullable<ReturnType<typeof parseTracker>>; stats: NonNullable<ReturnType<typeof computeStats>> }) {
  const weeks = weeklySeries(tracker, s);
  const months = monthlySeries(weeks);
  const members = memberStats(tracker, s);
  const checks = reconcile(tracker, s);
  const roi = (x: number) => `${x > 0 ? "+" : ""}${formatPct(x)} ROI`;

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Figures cover {s.weeks} weeks (from {formatDate(weeks[0]?.start ?? null)}, latest week starts{" "}
        {formatDate(weeks.at(-1)?.start ?? null)}) and {s.members} members, from the TWOL (New) sheet.
      </p>

      <Panel title="Progress to target">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-3xl font-semibold text-slate-900 dark:text-white">{formatGBP(s.pot)}</p>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            of {formatGBP(s.target)} target ({formatPct(s.progress)})
          </p>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700" role="progressbar" aria-valuenow={Math.round(s.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to target">
          <div className="h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${Math.min(100, s.progress * 100)}%` }} />
        </div>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          At the current average of {formatGBP(s.avgPotPerWeek)} a week, the target is reached around{" "}
          <span className="font-medium">{formatDate(s.projectedDate)}</span> (about {Math.round(s.totalWeeksToTarget - s.weeks)} more
          weeks). The sheet&apos;s own estimate gives the same date.
        </p>
      </Panel>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Pot (overall)" value={formatGBP(s.pot)} note="Banked + punts + fines + interest" />
        <Tile label="Paid in" value={formatGBP(s.paidIn)} note={`${s.weeks} weeks x ${formatGBP(s.paidIn / s.weeks)}`} />
        <Tile label="Returns (punts)" value={formatGBP(s.punts)} note="Members' weekly punts, summed" />
        <Tile label="Staked (assumed)" value={formatGBP(s.staked)} note="Paid in minus banked" />
        <Tile
          label="Bet P&L"
          value={signed(s.betPnl)}
          note={`Returns minus stakes, ${roi(s.betRoi)}`}
          tone={s.betPnl >= 0 ? "pos" : "neg"}
        />
        <Tile
          label="Overall P&L"
          value={signed(s.overallPnl)}
          note={`Pot minus paid in, ${roi(s.overallRoi)}`}
          tone={s.overallPnl >= 0 ? "pos" : "neg"}
        />
        <Tile label="Fines paid" value={formatGBP(s.fines)} note={`${formatGBP(s.overdue)} marked overdue`} />
        <Tile label="Interest" value={formatGBP(s.interest)} note="Interest updated on the sheet" />
        <Tile
          label="Strike rate (proxy)"
          value={formatPct(s.memberWeeks ? s.memberWeeksWithReturn / s.memberWeeks : 0)}
          note={`${s.memberWeeksWithReturn} of ${s.memberWeeks} member-weeks had a return. Not a bet strike rate.`}
        />
        <Tile label="Best single punt" value={formatGBP(s.bestPunt)} note="Highest member-week punt" />
        <Tile label="Best week" value={formatGBP(s.bestWeek)} note="Highest total punts in one week" />
        <Tile label="Average pot per week" value={formatGBP(s.avgPotPerWeek)} note="Pot divided by weeks played" />
      </section>

      <Panel title="Cumulative bet P&L over time" id="pnl">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Each week&apos;s returns minus its stakes, added up. Fines and interest are only recorded as totals, so they are
          not in the weekly line (they are in overall P&L above).
        </p>
        <CumulativeChart
          data={weeks.map((w) => ({
            x: `Wk ${w.week}`,
            y: Math.round(w.cumBetPnl * 100) / 100,
            detail: `${formatDate(w.start)} · punts ${formatGBP(w.punts)} · staked ${formatGBP(w.staked)}`,
          }))}
        />
        <TableTwin
          summary="View as table"
          head={["Week", "Starts", "Punts", "Staked", "Bet P&L", "Cumulative"]}
          rows={weeks.map((w) => [
            w.week,
            formatDate(w.start),
            formatGBP(w.punts),
            formatGBP(w.staked),
            signed(w.betPnl),
            signed(w.cumBetPnl),
          ])}
        />
      </Panel>

      <Panel title="By month: bet P&L">
        <BarChartView
          orientation="vertical"
          height={240}
          data={months.map((m) => ({
            label: m.label,
            value: Math.round(m.betPnl * 100) / 100,
            detail: `${m.weeks} weeks · punts ${formatGBP(m.punts)} · staked ${formatGBP(m.staked)}`,
          }))}
        />
        <TableTwin
          summary="View as table"
          head={["Month", "Weeks", "Punts", "Staked", "Bet P&L"]}
          rows={months.map((m) => [m.label, m.weeks, formatGBP(m.punts), formatGBP(m.staked), signed(m.betPnl)])}
        />
      </Panel>

      <Panel title="By member: total punts">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Total returns each member has brought in. Full figures per member are on the{" "}
          <Link href="/members" className="underline underline-offset-2">
            Members page
          </Link>
          .
        </p>
        <BarChartView
          orientation="horizontal"
          height={Math.max(220, members.length * 28)}
          data={members.map((m) => ({
            label: m.name,
            value: Math.round(m.punts * 100) / 100,
            detail: `${formatPct(m.puntsShare)} of all punts`,
          }))}
        />
      </Panel>

      <Panel title="By sport, market and bet type">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Not available. The spreadsheet records weekly totals per member, not individual bets, so it has no sport,
          market or bet-type columns to break down.
        </p>
      </Panel>

      <Panel title="Checks against the spreadsheet&apos;s own totals">
        <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {checks.map((c) => (
            <li key={c.label} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-slate-700 dark:text-slate-200">{c.label}</span>
              <span className="tabular-nums text-slate-600 dark:text-slate-300">
                app {Number(c.app.toFixed(4))} · sheet {Number(c.sheet.toFixed(4))}{" "}
                <span className={c.ok ? "font-medium text-emerald-700 dark:text-emerald-400" : "font-medium text-rose-700 dark:text-rose-400"}>
                  {c.ok ? "Matches" : "Mismatch"}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="How the figures are worked out">
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
          <li>Returns are the members&apos; weekly punts from the sheet. The sheet has no separate stake or odds columns.</li>
          <li>
            Each member pays {formatGBP(s.paidIn / s.weeks / s.members)} a week: {formatGBP(2.5)} is banked and the rest is
            staked. Staked = paid in minus banked, so it is an assumption that the rest goes on bets.
          </li>
          <li>Pot = banked + punts + fines + interest, the same formula as the sheet&apos;s &quot;Overall&quot;.</li>
          <li>Week dates count from the sheet&apos;s starting date, 7 days per week. Weeks with no banking are not counted.</li>
          <li>The old tracker (TWOL (Old)) covers the first 10 weeks and is not used in these totals.</li>
        </ul>
      </Panel>
    </div>
  );
}
