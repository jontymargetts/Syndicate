import Link from "next/link";
import BarChartView from "@/components/BarChart";
import CumulativeChart from "@/components/CumulativeChart";
import { fetchLedgerData } from "@/lib/records";
import { getIndex } from "@/lib/data";
import { loadTracker } from "@/lib/tracker";
import {
  type Ledger,
  type Stats,
  type Tracker,
  OTHER_PROPOSER,
  WEEKLY_BANKED,
  WEEKLY_PAYMENT,
  WEEKLY_STAKE,
  buildLedger,
  byProposer,
  computeStats,
  cumulativeSeries,
  emptyLedger,
  formatDate,
  formatGBP,
  formatPct,
  lastSpreadsheetDay,
  memberStats,
  monthlySeries,
  recentSettled,
  reconcile,
  weeklySeries,
} from "@/lib/stats";

// Database rows are read on every request, so the figures follow the queue, results, fines and payments without a redeploy.
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
  const tracker = loadTracker();
  const sheetStats = tracker ? computeStats(tracker) : null;

  // Database data: null when no database is configured or the query fails. The page then shows spreadsheet figures only.
  const data = await fetchLedgerData();

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
          ledger={data ? buildLedger(tracker, new Date(), data) : emptyLedger()}
          connected={data !== null}
        />
      )}

      <section className="flex flex-wrap gap-3">
        <Link
          href="/bets"
          className="inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
        >
          Open the Bet Queue
        </Link>
        {(["/payments", "/results", "/fines"] as const).map((href) => (
          <Link
            key={href}
            href={href}
            className="inline-block rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-800"
          >
            {href === "/payments" ? "Payments" : href === "/results" ? "Results" : "Fines"}
          </Link>
        ))}
      </section>
    </div>
  );
}

// Split out so the stats-dependent markup is only built when there is data.
function Dashboard({
  tracker,
  sheetStats,
  ledger,
  connected,
}: {
  tracker: Tracker;
  sheetStats: Stats;
  ledger: Ledger;
  connected: boolean;
}) {
  // With an empty ledger (no database, or nothing recorded after the cut-off) this equals sheetStats.
  const s = computeStats(tracker, ledger) ?? sheetStats;
  const weeks = weeklySeries(tracker);
  const months = monthlySeries(weeks, ledger.bets, ledger.allocations);
  const members = memberStats(tracker, s, ledger);
  const proposers = byProposer(tracker, ledger.bets);
  const other = proposers.find((p) => p.name === OTHER_PROPOSER);
  const checks = reconcile(tracker, sheetStats);
  const cutoffDay = lastSpreadsheetDay(tracker);
  const recent = recentSettled(ledger.bets, 10);
  const series = cumulativeSeries(weeks, ledger.bets, ledger.allocations);
  const roi = (x: number) => `${x > 0 ? "+" : ""}${formatPct(x)} ROI`;
  const decided = s.settledWon + s.settledLost;
  const afterCutoff = s.postWeeks > 0 || ledger.bets.length > 0 || ledger.finesPaid > 0 || ledger.finesOverdue > 0;

  return (
    <div className="space-y-8">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        Figures cover {sheetStats.weeks} weeks (from {formatDate(weeks[0]?.start ?? null)}, latest week starts{" "}
        {formatDate(weeks.at(-1)?.start ?? null)}) and {sheetStats.members} members, from the TWOL (New) sheet.
        {connected && cutoffDay && (
          <>
            {" "}
            Includes payments, bets, results and fines recorded after {formatDate(cutoffDay)}
            {s.postWeeks > 0 ? `: ${s.postWeeks} week${s.postWeeks === 1 ? "" : "s"} since the sheet ends, counted up to this week.` : " (no weeks since the sheet ends yet)."}
          </>
        )}
        {!connected && " The shared database is not connected, so only the sheet is shown."}
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
        <Tile label="Pot (overall)" value={formatGBP(s.pot)} note="Banked + punts + fines paid + interest" />
        <Tile
          label="Paid in"
          value={formatGBP(s.paidIn)}
          note={
            s.paidMemberWeeks
              ? `${s.weeks} sheet weeks, plus ${s.paidMemberWeeks} paid member-weeks at ${formatGBP(WEEKLY_PAYMENT)}`
              : `${s.weeks} weeks x ${formatGBP(s.paidIn / s.weeks)}`
          }
        />
        <Tile
          label="Returns (punts)"
          value={formatGBP(s.punts)}
          note={afterCutoff ? `Members' weekly punts plus ${formatGBP(s.settledReturns)} from bets and results` : "Members' weekly punts, summed"}
        />
        <Tile
          label="Staked"
          value={formatGBP(s.staked)}
          note={
            s.paidMemberWeeks
              ? `Paid in minus banked, plus ${formatGBP(WEEKLY_STAKE)} per paid member-week since the sheet ends`
              : "Paid in minus banked"
          }
        />
        <Tile
          label="Bet P&L"
          value={signed(s.betPnl)}
          note={`Returns minus staked, ${roi(s.betRoi)}`}
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
            label="Strike rate (settled bets)"
            value={formatPct(s.strikeRate ?? 0)}
            note={`${s.settledWon} won, ${s.settledLost} lost, ${s.settledVoid} void. Void bets are not counted.`}
          />
        )}
        {s.settledBets > 0 && (
          <Tile
            label="Stakes placed"
            value={formatGBP(s.placedStakes)}
            note={`On ${s.settledBets} settled bets since the sheet ends. Paid for from the weekly stake, not counted again.`}
          />
        )}
        <Tile label="Best single punt" value={formatGBP(sheetStats.bestPunt)} note="Highest member-week punt" />
        <Tile label="Best week" value={formatGBP(sheetStats.bestWeek)} note="Highest total punts in one week" />
        <Tile label="Average pot per week" value={formatGBP(sheetStats.avgPotPerWeek)} note="Spreadsheet pot divided by weeks played" />
      </section>

      <Panel title="Cumulative bet P&L over time" id="pnl">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Each sheet week&apos;s returns minus its stakes, added up. After the sheet ends, each week&apos;s stake allocation
          steps the line down and each settled bet or result steps it up by its returns, in date order. Fines and interest
          are not in this line (they are in overall P&amp;L above).
        </p>
        <CumulativeChart
          data={series.map((p) => ({
            x: p.x,
            y: Math.round(p.cum * 100) / 100,
            detail: p.week
              ? `${formatDate(p.week.start)} · punts ${formatGBP(p.week.punts)} · staked ${formatGBP(p.week.staked)}`
              : p.allocation
                ? `${formatDate(p.allocation.start)} · ${p.allocation.paidMembers} paid x ${formatGBP(WEEKLY_STAKE)} staked`
                : p.bet
                  ? `${formatDate(p.bet.settledAt)} · ${p.bet.source === "result" ? "Result" : `${p.bet.selection} @ ${p.bet.placedOdds?.toFixed(2) ?? "-"}`} · ${RESULT_LABEL[p.bet.status]} · returns ${formatGBP(p.bet.returns)}`
                  : "",
          }))}
        />
        <TableTwin
          summary="View sheet weeks as table"
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

      {connected && (
        <Panel title="Recent settled bets and results" id="recent">
          {recent.length === 0 ? (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Nothing settled since {cutoffDay ? formatDate(cutoffDay) : "the spreadsheet's last week"} yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700">
              <table className="min-w-full divide-y divide-slate-200 text-sm dark:divide-slate-700">
                <thead className="bg-slate-50 dark:bg-slate-800">
                  <tr>
                    {["Source", "Event", "Selection", "Odds", "Stake", "Result", "Returns"].map((h) => (
                      <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-slate-600 dark:text-slate-300">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {recent.map((b) => (
                    <tr key={`${b.source}-${b.id}`}>
                      <td className="whitespace-nowrap px-3 py-2 text-slate-500 dark:text-slate-400">{b.source === "queue" ? "Queue" : "Result"}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{b.event}</td>
                      <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{b.selection || "-"}</td>
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums">{b.placedOdds?.toFixed(2) ?? "-"}</td>
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
          Total returns each member has brought in, including bets and results credited to them. Full figures per member are on the{" "}
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
                    detail: `${formatPct(s.punts ? other.returns / s.punts : 0)} of all punts (bets and results credited to names not on the sheet, or to the syndicate)`,
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
        <p className="text-sm text-slate-600 dark:text-slate-300">These compare the spreadsheet import only. Nothing recorded in the database is part of the sheet.</p>
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
            Each member pays {formatGBP(WEEKLY_PAYMENT)} a week by standing order: {formatGBP(WEEKLY_BANKED)} is banked and{" "}
            {formatGBP(WEEKLY_STAKE)} is staked. After the sheet ends, every member counts as paid for each week up to this one, unless a
            missed payment is recorded on the Payments page.
          </li>
          <li>
            Staked = paid in minus banked (the sheet&apos;s rule), plus {formatGBP(WEEKLY_STAKE)} for each paid member-week after the
            sheet. Stakes on individual bets are paid for from that weekly stake, so they are not added again.
          </li>
          <li>
            Punts = the members&apos; weekly returns from the sheet, plus the returns of bets and results settled after the sheet
            (returns include the stake: won = stake x odds, lost = £0, void = stake refunded). Bet P&amp;L = punts minus staked.
          </li>
          <li>
            Pot = banked + punts + fines paid + interest, the sheet&apos;s own &quot;Overall&quot; formula. Overall P&amp;L = pot minus
            paid in, which equals bet P&amp;L + fines paid + interest.
          </li>
          <li>
            Fines paid after the sheet count towards fines paid and the pot once marked paid. Unpaid fines given after the sheet are
            overdue (shown, not in the pot).
          </li>
          <li>
            Bets, results, payments and fines count only from the cut-off: the day after the last week in the spreadsheet. The
            cut-off moves forward when a newer spreadsheet is imported, and anything recorded before it stops being counted separately.
          </li>
          <li>Week dates count from the sheet&apos;s starting date, 7 days per week. Weeks in the future are never counted.</li>
          <li>The old tracker (TWOL (Old)) covers the first 10 weeks and is not used in these totals.</li>
        </ul>
      </Panel>
    </div>
  );
}
