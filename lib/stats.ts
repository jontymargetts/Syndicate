import type { Row, Sheet, Table } from "./data";
import type { SettledStatus } from "./bets";

// Pure statistics for the syndicate. No file access here, so this module is safe to import
// from server components, client components and plain Node scripts (scripts/check-stats.mts).
//
// Two sources feed the figures:
//   1. The spreadsheet (TWOL (New) sheet), imported into data/*.json. Weekly punts, banked, fines,
//      interest and paid in, for weeks 1..N (N = weeks with banking recorded).
//   2. Settled bets in the shared bet queue (Postgres). Only bets settled AFTER the spreadsheet's
//      last week are included (see queueCutoff), so nothing is counted twice.
//
// What the spreadsheet records: weekly totals per member, not individual bets.
// The queue records per-bet stakes, odds and returns, so per-bet strike rate is available for queue bets only.
//
// Assumptions (confirmed by the leader, stated on the dashboard):
//   - Each member pays 5.00 a week: 2.50 is banked and 2.50 is staked on bets, every week.
//   - Week n starts on the "Starting Date" plus 7 * (n - 1) days (UTC).
//   - Equal shares: every member pays the same amount, so each member's pot share is pot / members.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export type Tracker = {
  members: MemberData[];
  /** Week numbers with banking recorded, ascending (e.g. 1..39). */
  weekNumbers: number[];
  startDate: Date | null;
  /** Summary cells as label -> first numeric value found with that label. */
  summary: Map<string, number>;
  /** Largest constant "Target" value on the sheet (the pot target, e.g. 5000). */
  target: number | null;
  /** Total paid in ("Overall paid" / "Invested" on the sheet). */
  paidIn: number | null;
  /** Totals row values from the Fines table, used only for reconciliation. */
  sheetFinesTotal: { fines: number | null; overdue: number | null };
};

export type MemberData = {
  name: string;
  /** Aligned to Tracker.weekNumbers. */
  punts: number[];
  banked: number[];
  fines: number;
  overdue: number;
  leaderboardTotal: number | null;
};

/** A settled bet from the shared queue, with the figures needed for the tracker. Money in GBP. */
export type SettledQueueBet = {
  id: string;
  event: string;
  selection: string;
  /** Who proposed the bet (free text). Matched to a member's first name for the Members page. */
  proposedBy: string;
  status: SettledStatus;
  placedOdds: number;
  placedStake: number;
  /** Total paid back, stake included. Won = stake x odds, lost = 0, void = stake. */
  returns: number;
  settledAt: Date;
};

export type Stats = {
  members: number;
  weeks: number;
  paidIn: number;
  banked: number;
  /** Punts from the spreadsheet plus queue returns. */
  punts: number;
  /** Stakes: paid in minus banked (spreadsheet) plus queue stakes. */
  staked: number;
  fines: number;
  overdue: number;
  interest: number;
  pot: number;
  target: number;
  progress: number;
  /** Bet P&L: punts minus stakes (spreadsheet and queue). */
  betPnl: number;
  betRoi: number;
  /** Overall P&L: pot minus paid in (includes fines and interest). */
  overallPnl: number;
  overallRoi: number;
  avgPotPerWeek: number;
  /** Total weeks to reach target at the average pot per week (includes weeks already played). */
  totalWeeksToTarget: number;
  projectedDate: Date | null;
  /** Member-weeks with a non-zero return. Proxy only: the sheet has no bet-level results. */
  memberWeeksWithReturn: number;
  memberWeeks: number;
  bestPunt: number;
  bestWeek: number;
  // Queue bets (already filtered to after the cut-off). Zero when there are none.
  queueBets: number;
  queueWon: number;
  queueLost: number;
  queueVoid: number;
  queueStaked: number;
  queueReturns: number;
  /** won / (won + lost) for queue bets. Void bets are not counted. Null until a bet has won or lost. */
  queueStrikeRate: number | null;
};

export type WeekPoint = {
  week: number;
  start: Date | null;
  /** Yyyy-mm of the week start (UTC), used for monthly grouping. */
  month: string | null;
  punts: number;
  banked: number;
  staked: number;
  betPnl: number;
  cumBetPnl: number;
};

export type MonthPoint = {
  month: string;
  label: string;
  weeks: number;
  punts: number;
  staked: number;
  betPnl: number;
};

export type MemberStat = {
  name: string;
  /** Spreadsheet punts plus queue returns attributed to this member. */
  punts: number;
  /** Queue returns attributed to this member (included in punts). */
  queueReturns: number;
  puntsShare: number;
  weeksWithReturn: number;
  bestPunt: number;
  fines: number;
  overdue: number;
  banked: number;
  paidIn: number;
  potShare: number;
  /** Equal-share P&L: pot share minus paid-in share. */
  pnl: number;
};

export const OTHER_PROPOSER = "Other";

/** Queue bets grouped by who proposed them. Names are matched to members case-insensitively. */
export type QueueAttribution = {
  name: string;
  bets: number;
  won: number;
  lost: number;
  void: number;
  staked: number;
  returns: number;
};

export type CumulativePoint = {
  x: string;
  /** Cumulative bet P&L after this point. */
  cum: number;
  week?: WeekPoint;
  bet?: SettledQueueBet;
};

export type Check = { label: string; app: number; sheet: number; ok: boolean };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function tableNamed(sheet: Sheet, title: string): Table | null {
  return sheet.tables.find((t) => t.title === title) ?? null;
}

function memberRows(t: Table | null): Row[] {
  if (!t) return [];
  return t.rows.filter((r) => {
    const m = r.Member;
    return typeof m === "string" && !/^(week total|total)/i.test(m);
  });
}

function parseIsoDate(raw: unknown): Date | null {
  if (typeof raw !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Parses the "TWOL (New)" tracker sheet. Returns null if the expected tables are missing. */
export function parseTracker(sheet: Sheet | null): Tracker | null {
  if (!sheet) return null;
  const puntsT = tableNamed(sheet, "Weekly punts");
  const bankedT = tableNamed(sheet, "Banked");
  const finesT = tableNamed(sheet, "Fines");
  const lbT = tableNamed(sheet, "Leaderboard source");
  const summaryT = tableNamed(sheet, "Summary cells");
  if (!puntsT || !bankedT || !finesT) return null;

  // Summary cells: keep the first numeric value for each label, and every constant "Target" value.
  const summary = new Map<string, number>();
  const targets: number[] = [];
  let startDate: Date | null = null;
  for (const r of summaryT?.rows ?? []) {
    const label = typeof r.Label === "string" ? r.Label.trim() : "";
    const value = r.Value;
    if (label === "Starting Date") startDate = parseIsoDate(value);
    if (typeof value !== "number") continue;
    if (!summary.has(label)) summary.set(label, value);
    if (label === "Target" && r.Formula === null) targets.push(value);
  }

  const weekCols = (t: Table) =>
    t.columns.flatMap((c) => {
      const m = /^Week (\d+)$/.exec(c);
      return m ? [{ col: c, n: Number(m[1]) }] : [];
    });

  const bankedRows = memberRows(bankedT);
  const played = weekCols(bankedT).filter(
    (w) => bankedRows.reduce((s, r) => s + num(r[w.col]), 0) > 0,
  );

  const puntsByName = new Map(memberRows(puntsT).map((r) => [String(r.Member), r]));
  const finesByName = new Map(memberRows(finesT).map((r) => [String(r.Member), r]));
  const lbByName = new Map(memberRows(lbT ?? null).map((r) => [String(r.Member), r]));

  const members: MemberData[] = bankedRows.map((b) => {
    const name = String(b.Member);
    const p = puntsByName.get(name);
    const f = finesByName.get(name);
    const lb = lbByName.get(name);
    return {
      name,
      punts: played.map((w) => num(p?.[w.col])),
      banked: played.map((w) => num(b[w.col])),
      fines: num(f?.["Fines Paid"]),
      overdue: num(f?.Overdue),
      leaderboardTotal: typeof lb?.Total === "number" ? lb.Total : null,
    };
  });

  const finesTotalRow = (finesT.rows as Row[]).find(
    (r) => typeof r.Member === "string" && /^total fines/i.test(r.Member),
  );

  return {
    members,
    weekNumbers: played.map((w) => w.n),
    startDate,
    summary,
    target: targets.length ? Math.max(...targets) : null,
    paidIn: summary.get("Overall paid") ?? null,
    sheetFinesTotal: {
      fines: typeof finesTotalRow?.["Fines Paid"] === "number" ? (finesTotalRow["Fines Paid"] as number) : null,
      overdue: typeof finesTotalRow?.Overdue === "number" ? (finesTotalRow.Overdue as number) : null,
    },
  };
}

function weekStart(t: Tracker, week: number): Date | null {
  if (!t.startDate) return null;
  return new Date(t.startDate.getTime() + (week - 1) * WEEK_MS);
}

function monthKey(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- queue bets: cut-off and filtering ----------

/**
 * The cut-off: Starting Date + 7 x weeks played, i.e. the first instant after the spreadsheet's last week.
 * A queue bet feeds the figures only if it was settled at or after this instant. Bets settled before it
 * are already in the spreadsheet (or were never meant to count), so they must not be counted again.
 * Re-importing a later spreadsheet moves this forward automatically.
 */
export function queueCutoff(t: Tracker): Date | null {
  if (!t.startDate) return null;
  return new Date(t.startDate.getTime() + t.weekNumbers.length * WEEK_MS);
}

/** The last day covered by the spreadsheet (the day before the cut-off). Used in the dashboard wording. */
export function lastSpreadsheetDay(t: Tracker): Date | null {
  const cutoff = queueCutoff(t);
  return cutoff ? new Date(cutoff.getTime() - DAY_MS) : null;
}

/** Settled queue bets that feed the figures: settled at or after the cut-off, oldest first. */
export function includedQueueBets(t: Tracker, bets: SettledQueueBet[]): SettledQueueBet[] {
  const cutoff = queueCutoff(t);
  if (!cutoff) return [];
  return bets
    .filter((b) => b.settledAt.getTime() >= cutoff.getTime())
    .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
}

/** The most recently settled bets, newest first. */
export function recentSettled(bets: SettledQueueBet[], n = 10): SettledQueueBet[] {
  return [...bets].sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime()).slice(0, n);
}

/**
 * Queue bets grouped by proposer. Each proposer is matched to a member name from the sheet, case-insensitively.
 * Members with no bets appear with zeros. Bets from anyone else go under "Other" (only listed if there are some).
 */
export function queueByProposer(t: Tracker, bets: SettledQueueBet[]): QueueAttribution[] {
  const memberByKey = new Map(t.members.map((m) => [m.name.trim().toLowerCase(), m.name]));
  const blank = (name: string): QueueAttribution => ({ name, bets: 0, won: 0, lost: 0, void: 0, staked: 0, returns: 0 });
  const rows = new Map<string, QueueAttribution>(t.members.map((m) => [m.name, blank(m.name)]));
  for (const b of bets) {
    const name = memberByKey.get(b.proposedBy.trim().toLowerCase()) ?? OTHER_PROPOSER;
    const row = rows.get(name) ?? blank(name);
    rows.set(name, row);
    row.bets += 1;
    if (b.status === "settled_won") row.won += 1;
    else if (b.status === "settled_lost") row.lost += 1;
    else row.void += 1;
    row.staked += b.placedStake;
    row.returns += b.returns;
  }
  return [...rows.values()].filter((r) => r.name !== OTHER_PROPOSER || r.bets > 0);
}

// ---------- totals ----------

/**
 * Totals and KPIs. `queue` must already be filtered with includedQueueBets. Pass [] for spreadsheet-only figures.
 * Returns null if the paid-in figure or the target is missing from the sheet.
 *
 * Pot formula (the sheet's own, extended for queue bets):
 *   pot = banked + punts + fines + interest
 *       = paidIn - staked + punts + fines + interest     (because banked = paidIn - staked, sheet identity)
 * With queue bets, punts = sheetPunts + queueReturns and staked = (paidIn - banked) + queueStakes, so
 *   pot = sheetPot + queueReturns - queueStakes
 * That is, each queue bet moves the pot by returns - stake: its stake leaves the pot when placed, and its
 * returns come back into it when it settles. Overall P&L = pot - paidIn = betPnl + fines + interest still holds.
 *
 * Average pot per week and the projected date use the spreadsheet's pot and weeks, so they describe the
 * spreadsheet's pace. Progress to target uses the full pot.
 */
export function computeStats(t: Tracker, queue: SettledQueueBet[] = []): Stats | null {
  if (t.paidIn === null || t.target === null) return null;
  const weeks = t.weekNumbers.length;
  const members = t.members.length;
  const weekIdx = Array.from({ length: weeks }, (_, i) => i);

  const sheetPunts = t.members.reduce((s, m) => s + m.punts.reduce((a, b) => a + b, 0), 0);
  const banked = t.members.reduce((s, m) => s + m.banked.reduce((a, b) => a + b, 0), 0);
  const fines = t.members.reduce((s, m) => s + m.fines, 0);
  const overdue = t.members.reduce((s, m) => s + m.overdue, 0);
  const interest = t.summary.get("Intrest updated") ?? 0;
  const paidIn = t.paidIn;

  const queueStaked = queue.reduce((s, b) => s + b.placedStake, 0);
  const queueReturns = queue.reduce((s, b) => s + b.returns, 0);
  const queueWon = queue.filter((b) => b.status === "settled_won").length;
  const queueLost = queue.filter((b) => b.status === "settled_lost").length;
  const queueVoid = queue.filter((b) => b.status === "settled_void").length;

  const punts = sheetPunts + queueReturns;
  const staked = paidIn - banked + queueStaked;
  const pot = banked + punts + fines + interest - queueStaked;
  const sheetPot = banked + sheetPunts + fines + interest;
  const betPnl = punts - staked;
  const overallPnl = pot - paidIn;
  const avgPotPerWeek = weeks ? sheetPot / weeks : 0;
  const totalWeeksToTarget = avgPotPerWeek ? t.target / avgPotPerWeek : 0;
  const projectedDate =
    t.startDate && totalWeeksToTarget
      ? new Date(Math.floor(t.startDate.getTime() + totalWeeksToTarget * WEEK_MS))
      : null;

  let memberWeeksWithReturn = 0;
  let bestPunt = 0;
  for (const m of t.members) {
    for (const p of m.punts) {
      if (p > 0) memberWeeksWithReturn++;
      if (p > bestPunt) bestPunt = p;
    }
  }
  const bestWeek = Math.max(
    0,
    ...weekIdx.map((i) => t.members.reduce((s, m) => s + num(m.punts[i]), 0)),
  );

  const decided = queueWon + queueLost;
  return {
    members,
    weeks,
    paidIn,
    banked,
    punts,
    staked,
    fines,
    overdue,
    interest,
    pot,
    target: t.target,
    progress: t.target ? pot / t.target : 0,
    betPnl,
    betRoi: staked ? betPnl / staked : 0,
    overallPnl,
    overallRoi: paidIn ? overallPnl / paidIn : 0,
    avgPotPerWeek,
    totalWeeksToTarget,
    projectedDate,
    memberWeeksWithReturn,
    memberWeeks: members * weeks,
    bestPunt,
    bestWeek,
    queueBets: queue.length,
    queueWon,
    queueLost,
    queueVoid,
    queueStaked,
    queueReturns,
    queueStrikeRate: decided ? queueWon / decided : null,
  };
}

// ---------- series and breakdowns ----------

/** One point per played week, with cumulative bet P&L (spreadsheet only). */
export function weeklySeries(t: Tracker, s: Stats): WeekPoint[] {
  const paidInPerWeek = s.weeks ? s.paidIn / s.weeks : 0;
  let cum = 0;
  return t.weekNumbers.map((week, i) => {
    const punts = t.members.reduce((acc, m) => acc + num(m.punts[i]), 0);
    const banked = t.members.reduce((acc, m) => acc + num(m.banked[i]), 0);
    const staked = paidInPerWeek - banked;
    const betPnl = punts - staked;
    cum += betPnl;
    const start = weekStart(t, week);
    return { week, start, month: monthKey(start), punts, banked, staked, betPnl, cumBetPnl: cum };
  });
}

/**
 * Cumulative bet P&L: one point per spreadsheet week, then one point per included queue bet in settled order.
 * Each queue bet adds returns - stake. The last point equals computeStats().betPnl.
 */
export function cumulativeSeries(weeks: WeekPoint[], queue: SettledQueueBet[]): CumulativePoint[] {
  const points: CumulativePoint[] = weeks.map((w) => ({ x: `Wk ${w.week}`, cum: w.cumBetPnl, week: w }));
  let cum = weeks.at(-1)?.cumBetPnl ?? 0;
  const ordered = [...queue].sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());
  ordered.forEach((bet, i) => {
    cum += bet.returns - bet.placedStake;
    points.push({ x: `Bet ${i + 1}`, cum, bet });
  });
  return points;
}

/** Weekly points grouped by calendar month. Queue bets are grouped by the month they settled in. */
export function monthlySeries(weeks: WeekPoint[], queue: SettledQueueBet[] = []): MonthPoint[] {
  const byMonth = new Map<string, MonthPoint>();
  const monthFor = (key: string): MonthPoint => {
    const existing = byMonth.get(key);
    if (existing) return existing;
    const created: MonthPoint = {
      month: key,
      label: new Date(`${key}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }),
      weeks: 0,
      punts: 0,
      staked: 0,
      betPnl: 0,
    };
    byMonth.set(key, created);
    return created;
  };
  for (const w of weeks) {
    if (!w.month) continue;
    const m = monthFor(w.month);
    m.weeks += 1;
    m.punts += w.punts;
    m.staked += w.staked;
    m.betPnl += w.betPnl;
  }
  for (const b of queue) {
    const key = monthKey(b.settledAt);
    if (!key) continue;
    const m = monthFor(key);
    m.punts += b.returns;
    m.staked += b.placedStake;
    m.betPnl += b.returns - b.placedStake;
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Per-member figures. Pot share and paid-in share are equal (every member pays the same). */
export function memberStats(t: Tracker, s: Stats, queue: SettledQueueBet[] = []): MemberStat[] {
  const potShare = s.members ? s.pot / s.members : 0;
  const paidShare = s.members ? s.paidIn / s.members : 0;
  const attributed = new Map(queueByProposer(t, queue).map((a) => [a.name, a.returns]));
  return t.members
    .map((m) => {
      const sheetPunts = m.punts.reduce((a, b) => a + b, 0);
      const queueReturns = attributed.get(m.name) ?? 0;
      const banked = m.banked.reduce((a, b) => a + b, 0);
      return {
        name: m.name,
        punts: sheetPunts + queueReturns,
        queueReturns,
        puntsShare: s.punts ? (sheetPunts + queueReturns) / s.punts : 0,
        weeksWithReturn: m.punts.filter((p) => p > 0).length,
        bestPunt: Math.max(0, ...m.punts),
        fines: m.fines,
        overdue: m.overdue,
        banked,
        paidIn: paidShare,
        potShare,
        pnl: potShare - paidShare,
      };
    })
    .sort((a, b) => b.punts - a.punts);
}

/** Compares our totals with the spreadsheet's own cells. Pass the spreadsheet-only stats (computeStats(t)). */
export function reconcile(t: Tracker, s: Stats): Check[] {
  const pairs: { label: string; app: number; sheet: number | undefined }[] = [
    { label: "Total punts (Total Punts)", app: s.punts, sheet: t.summary.get("Total Punts") },
    { label: "Total banked (Banked)", app: s.banked, sheet: t.summary.get("Banked") },
    { label: "Total fines paid", app: s.fines, sheet: t.sheetFinesTotal.fines ?? undefined },
    { label: "Total overdue", app: s.overdue, sheet: t.sheetFinesTotal.overdue ?? undefined },
    { label: "Overall pot (Overall)", app: s.pot, sheet: t.summary.get("Overall") },
    { label: "Paid in (Overall paid)", app: s.paidIn, sheet: t.summary.get("Overall paid") },
    { label: "Average pot per week", app: s.avgPotPerWeek, sheet: t.summary.get("Per week AVG") },
    { label: "Progress to target (% Target)", app: s.progress, sheet: t.summary.get("% Target") },
    { label: "Weeks played (Weeks gone)", app: s.weeks, sheet: t.summary.get("Weeks gone") },
  ];
  const checks: Check[] = [];
  for (const p of pairs) {
    if (p.sheet === undefined) continue;
    checks.push({ label: p.label, app: p.app, sheet: p.sheet, ok: Math.abs(p.app - p.sheet) < 0.01 });
  }
  const lbRows = t.members.filter((m) => m.leaderboardTotal !== null);
  if (lbRows.length) {
    const lbSheet = lbRows.reduce((acc, m) => acc + (m.leaderboardTotal ?? 0), 0);
    const lbApp = lbRows.reduce((acc, m) => acc + m.punts.reduce((a, b) => a + b, 0), 0);
    checks.push({ label: "Per-member totals (Leaderboard source)", app: lbApp, sheet: lbSheet, ok: Math.abs(lbApp - lbSheet) < 0.01 });
  }
  return checks;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });
export const formatGBP = (n: number) => gbp.format(n);
export const formatPct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;
export const formatDate = (d: Date | null) =>
  d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "n/a";
