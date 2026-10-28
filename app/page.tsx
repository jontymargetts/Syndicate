import Link from "next/link";
import BarChartView from "@/components/BarChart";
import CumulativeChart from "@/components/CumulativeChart";
import { fetchSettledQueueBets } from "@/lib/db";
import { getIndex, getSheet } from "@/lib/data";
import {
  type SettledQueueBet,
  type Stats,
  type Tracker,
  OTHER_PROPOSER,
  computeStats,
  cumulativeSeries,
  formatDate,
  formatGBP,
  formatPct,
  includedQueueBets,
  lastSpreadsheetDay,
  memberStats,
  monthlySeries,
  parseTracker,
  queueByProposer,
  recentSettled,
  reconcile,
  weeklySeries,
} from "@/lib/stats";

// Settled queue bets are read on every request, so the figures follow the queue without a redeploy.
export const dynamic = "force-dynamic";

const RESULT_LABEL = { settled_won: "Won", settled_lost: "Lost", settled_void: "Void" } as const;

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

export default async function DashboardPage() {
  const index = getIndex();
  const trackerMeta = index.sheets.find((s) => s.name === "TWOL (New)");
  const tracker = parseTracker(trackerMeta ? getSheet(trackerMeta.slug) : null);
  const sheetStats = tracker ? computeStats(tracker) : null;

  // Queue bets: null when no database is configured or the query fails. The page then shows spreadsheet figures only.
  const settledQueue = await fetchSettledQueueBets();

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

      {!tracker || !sheetStats ? (
        <section className="rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-400">
          <p className="font-medium text-slate-800 dark:text-slate-200">No tracker data imported.</p>
          <p className="mt-2">
            Run <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">python3 scripts/import-xlsx.py path/to/file.xlsx</code>{" "}
            and commit the generated files in <code>data/</code>. See the README for details.
          </p>
        </section>
      ) : (
        <Dashboard
          tracker={tracker}
          sheetStats={sheetStats}
          queue={settledQueue ? includedQueueBets(tracker, settledQueue) : []}
          queueConnected={settledQueue !== null}
        />
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
function Dashboard({
  tracker,
  sheetStats,
  queue,
  queueConnected,
}: {
  tracker: Tracker;
  sheetStats: Stats;
  queue: SettledQueueBet[];
  queueConnected: boolean;
}) {
  // With no queue bets (or no database) this equals sheetStats.
  const s = computeStats(tracker, queue) ?? sheetStats;
  const weeks = weeklySeries(tracker, s);
  const months = monthlySeries(weeks, queue);
  const members = memberStats(tracker, s, queue);
  const proposers = queueByProposer(tracker, queue);
  const other = proposers.find((p) => p.name === OTHER_PROPOSER);
  const checks = reconcile(tracker, sheetStats);
  const cutoffDay = lastSpreadsheetDay(tracker);
  const recent = recentSettled(queue, 10);
  const roi = (x: number) => `${x > 0 ? "+" : ""}${formatPct(x)} ROI`;
  const decided = s.queueWon + s.queueLost;

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Figures cover {sheetStats.weeks} weeks (from {formatDate(weeks[0]?.start ?? null)}, latest week starts{" "}
        {formatDate(weeks.at(-1)?.start ?? null)}) and {sheetStats.members} members, from the TWOL (New) sheet.
        {queueConnected && cutoffDay && (
          <>
            {" "}
            Includes queue bets settled after {formatDate(cutoffDay)}
            {queue.length ? ` (${queue.length} so far).` : " (none so far)."}
          </>
        )}
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
          At the spreadsheet&apos;s average of {formatGBP(sheetStats.avgPotPerWeek)} a week, the target is reached around{" "}
          <span className="font-medium">{formatDate(sheetStats.projectedDate)}</span> (about{" "}
          {Math.round(sheetStats.totalWeeksToTarget - sheetStats.weeks)} more weeks). The sheet&apos;s own estimate gives the same date.
        </p>
      </Panel>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="Pot (overall)" value={formatGBP(s.pot)} note="Banked + punts + fines + interest, less queue stakes" />
        <Tile label="Paid in" value={formatGBP(s.paidIn)} note={`${s.weeks} weeks x ${formatGBP(s.paidIn / s.weeks)}`} />
        <Tile
          label="Returns (punts)"
          value={formatGBP(s.punts)}
          note={queue.length ? `Members' weekly punts plus ${formatGBP(s.queueReturns)} from queue bets` : "Members' weekly punts, summed"}
        />
        <Tile
          label="Staked"
          value={formatGBP(s.staked)}
          note={queue.length ? "Paid in minus banked, plus queue stakes" : "Paid in minus banked"}
        />
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
          value={formatPct(sheetStats.memberWeeks ? sheetStats.memberWeeksWithReturn / sheetStats.memberWeeks : 0)}
          note={`${sheetStats.memberWeeksWithReturn} of ${sheetStats.memberWeeks} member-weeks had a return. Not a bet strike rate.`}
        />
        {decided > 0 && (
          <Tile
            label="Strike rate (queue bets)"
            value={formatPct(s.queueStrikeRate ?? 0)}
            note={`${s.queueWon} won, ${s.queueLost} lost, ${s.queueVoid} void. Void bets are not counted.`}
          />
        )}
        <Tile label="Best single punt" value={formatGBP(sheetStats.bestPunt)} note="Highest member-week punt" />
        <Tile label="Best week" value={formatGBP(sheetStats.bestWeek)} note="Highest total punts in one week" />
        <Tile label="Average pot per week" value={formatGBP(sheetStats.avgPotPerWeek)} note="Spreadsheet pot divided by weeks played" />
      </section>

      <Panel title="Cumulative bet P&L over time" id="pnl">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Each week&apos;s returns minus its stakes, added up, then each queue bet in the order it settled. Fines and interest are
          only recorded as totals, so they are not in this line (they are in overall P&amp;L above).
        </p>
        <CumulativeChart
          data={cumulativeSeries(weeks, queue).map((p) => ({
            x: p.x,
            y: Math.round(p.cum * 100) / 100,
            detail: p.week
              ? `${formatDate(p.week.start)} · punts ${formatGBP(p.week.punts)} · staked ${formatGBP(p.week.staked)}`
              : p.bet
                ? `${formatDate(p.bet.settledAt)} · ${p.bet.selection} @ ${p.bet.placedOdds.toFixed(2)} · ${RESULT_LABEL[p.bet.status]} · returns ${formatGBP(p.bet.returns)}`
                : "",
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

      {queueConnected && (
        <Panel title="Recent settled bets" id="recent">
          {recent.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              No queue bets settled since {cutoffDay ? formatDate(cutoffDay) : "the spreadsheet's last week"} yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {["Event", "Selection", "Odds", "Stake", "Result", "Returns"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recent.map((b) => (
                    <tr key={b.id}>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{b.event}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{b.selection}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{b.placedOdds.toFixed(2)}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(b.placedStake)}</td>
                      <td className="whitespace-nowrap px-3 py-2">{RESULT_LABEL[b.status]}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{formatGBP(b.returns)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      )}

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
          Total returns each member has brought in, including queue bets they proposed. Full figures per member are on the{" "}
          <Link href="/members" className="underline underline-offset-2">
            Members page
          </Link>
          .
        </p>
        <BarChartView
          orientation="horizontal"
          height={Math.max(220, (members.length + (other ? 1 : 0)) * 28)}
          data={[
            ...members.map((m) => ({
              label: m.name,
              value: Math.round(m.punts * 100) / 100,
              detail: `${formatPct(m.puntsShare)} of all punts`,
            })),
            ...(other
              ? [
                  {
                    label: OTHER_PROPOSER,
                    value: Math.round(other.returns * 100) / 100,
                    detail: `${formatPct(s.punts ? other.returns / s.punts : 0)} of all punts (queue bets from names not on the sheet)`,
                  },
                ]
              : []),
          ]}
        />
      </Panel>

      <Panel title="By sport, market and bet type">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Not available. The spreadsheet records weekly totals per member, not individual bets, so it has no sport,
          market or bet-type columns to break down.
        </p>
      </Panel>

      <Panel title="Checks against the spreadsheet's own totals">
        <p className="text-sm text-slate-600 dark:text-slate-300">These compare the spreadsheet import only. Queue bets are not part of the sheet.</p>
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
          <li>
            Each member pays {formatGBP(5)} a week: {formatGBP(2.5)} is banked and {formatGBP(2.5)} is staked on bets. Staked
            is paid in minus banked, plus the stakes of queue bets.
          </li>
          <li>
            Punts are the members&apos; weekly returns from the sheet, plus the returns of settled queue bets. Returns include the
            stake: won = stake x odds, lost = £0, void = stake refunded. Bet P&amp;L = returns minus stakes.
          </li>
          <li>
            Pot = banked + punts + fines + interest, the same formula as the sheet&apos;s &quot;Overall&quot;. Each queue bet
            takes its stake out and adds its returns, so pot = banked + punts + fines + interest minus queue stakes.
          </li>
          <li>
            Queue bets count only if settled after the last week in the spreadsheet (the cut-off), so a bet is never counted
            twice. The cut-off moves forward when a newer spreadsheet is imported.
          </li>
          <li>
            Weekly payments after the cut-off are not in the pot until the spreadsheet is re-imported, so the pot is lower than
            the real money held until then.
          </li>
          <li>Week dates count from the sheet&apos;s starting date, 7 days per week. Weeks with no banking are not counted.</li>
          <li>The old tracker (TWOL (Old)) covers the first 10 weeks and is not used in these totals.</li>
        </ul>
      </Panel>
    </div>
  );
}
