import type { Row, Sheet, Table } from "./data";
import type { SettledStatus } from "./bets";

// Pure statistics for the syndicate. No file access here, so this module is safe to import
// from server components, client components and plain Node scripts (scripts/check-stats.mts).
//
// Two kinds of input feed the figures:
//   1. The spreadsheet (TWOL (New) sheet), imported into data/*.json. Weekly punts, banked, fines,
//      interest and paid in, for weeks 1..N (N = weeks with banking recorded). These are the "sheet" figures.
//   2. The "ledger": everything recorded in the database AFTER the spreadsheet's last week (the cut-off):
//        - weekly payments (automatic: every member pays every week; only missed payments are stored),
//        - settled bets from the queue and results entered by hand,
//        - fines paid, and fines still unpaid.
//      Nothing before the cut-off is counted from the database, so nothing is counted twice.
//
// Assumptions (stated on the dashboard):
//   - Each member pays WEEKLY_PAYMENT (5) a week: WEEKLY_BANKED (2.50) is banked and WEEKLY_STAKE (2.50) is staked.
//   - Week n starts on the "Starting Date" plus 7 * (n - 1) days (UTC).
//   - Equal shares of the pot: every member has the same share of the pot. Paid in is shared equally before the
//     cut-off and then follows each member's own payments after it.

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

export const WEEKLY_PAYMENT = 5;
export const WEEKLY_BANKED = 2.5;
export const WEEKLY_STAKE = 2.5;

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

/** A settled bet that feeds the figures: a settled queue bet, or a result entered by hand. Money in GBP. */
export type SettledBet = {
  id: string;
  source: "queue" | "result";
  event: string;
  selection: string;
  /** Who proposed the bet (queue) or which member it is credited to (result). Matched to a member's name. */
  proposedBy: string;
  status: SettledStatus;
  /** Queue bets only. */
  placedOdds?: number;
  /** The stake. For queue bets this is the placed stake. It is not used for "staked" (see computeStats). */
  placedStake: number;
  /** Total paid back, stake included. Won = stake x odds, lost = 0, void = stake. */
  returns: number;
  /** Queue: when it settled. Result: the result date at 00:00 UTC. */
  settledAt: Date;
};

/** A fine as stored in the database. */
export type FineRecord = {
  id: string;
  member: string;
  amount: number;
  reason: string;
  /** The date the fine was given (00:00 UTC). */
  fineDate: Date;
  paidAt: Date | null;
};

/** A stored payment exception. A member-week with no exception is paid. */
export type PaymentException = {
  member: string;
  weekNumber: number;
  paid: boolean;
  note: string;
};

/** The stake money collected for one post-cut-off week: WEEKLY_STAKE for each paid member. */
export type StakeAllocation = {
  week: number;
  start: Date | null;
  paidMembers: number;
  amount: number;
};

export type MemberPayments = {
  member: string;
  paidWeeks: number;
  missedWeeks: number;
  /** Paid in after the cut-off for this member (paidWeeks x WEEKLY_PAYMENT). */
  paidAmount: number;
};

export type FinesByMember = Record<string, { paid: number; overdue: number }>;

/** Everything recorded after the cut-off, already worked out for the figures. */
export type Ledger = {
  /** The cut-off instant, or null when the spreadsheet has no start date. */
  cutoff: Date | null;
  /** Weeks after the cut-off that count so far: from the first week after the sheet up to the current week. */
  postWeeks: number[];
  /** Settled bets (queue and results) settled on or after the cut-off, oldest first. */
  bets: SettledBet[];
  /** One per post-cut-off week. */
  allocations: StakeAllocation[];
  /** Paid member-weeks after the cut-off (the sum of the paid members in each week). */
  paidMemberWeeks: number;
  payments: MemberPayments[];
  /** Fines paid after the cut-off (paid_at on or after the cut-off). */
  finesPaid: number;
  /** Fines given on or after the cut-off and still unpaid. */
  finesOverdue: number;
  finesByMember: FinesByMember;
};

export type LedgerInput = {
  bets: SettledBet[];
  payments: PaymentException[];
  fines: FineRecord[];
};

export type Stats = {
  members: number;
  /** Weeks in the spreadsheet (weeks up to the cut-off). */
  weeks: number;
  /** Weeks after the cut-off counted so far. */
  postWeeks: number;
  /** Paid member-weeks after the cut-off. */
  paidMemberWeeks: number;
  /** Paid in: the sheet's paid in plus WEEKLY_PAYMENT per paid member-week after the cut-off. */
  paidIn: number;
  /** Banked: the sheet's banked plus WEEKLY_BANKED per paid member-week after the cut-off. */
  banked: number;
  /** Punts: the sheet's weekly punts plus the returns of settled bets after the cut-off. */
  punts: number;
  /** Staked: the sheet's paid in minus banked, plus the weekly stake allocation after the cut-off (not bet stakes). */
  staked: number;
  /** Stakes placed on settled bets after the cut-off (information only: not used for staked or the pot). */
  placedStakes: number;
  /** Fines paid: the sheet's fines plus fines paid after the cut-off. */
  fines: number;
  /** Overdue: the sheet's overdue plus unpaid fines given after the cut-off. */
  overdue: number;
  interest: number;
  pot: number;
  target: number;
  progress: number;
  /** Bet P&L: punts minus staked. */
  betPnl: number;
  betRoi: number;
  /** Overall P&L: pot minus paid in. Equals bet P&L + fines paid + interest. */
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
  // Settled bets after the cut-off (queue and results). Zero when there are none.
  settledBets: number;
  settledWon: number;
  settledLost: number;
  settledVoid: number;
  settledReturns: number;
  /** won / (won + lost). Void bets are not counted. Null until a bet has won or lost. */
  strikeRate: number | null;
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
  /** Spreadsheet punts plus settled-bet returns attributed to this member. */
  punts: number;
  /** Returns attributed to this member after the cut-off (included in punts). */
  queueReturns: number;
  puntsShare: number;
  weeksWithReturn: number;
  bestPunt: number;
  fines: number;
  overdue: number;
  banked: number;
  /** Equal share of the sheet's paid in, plus this member's own payments after the cut-off. */
  paidIn: number;
  potShare: number;
  /** Pot share minus paid in. */
  pnl: number;
};

export const OTHER_PROPOSER = "Other";

/** Settled bets grouped by who proposed them. Names are matched to members case-insensitively. */
export type ProposerTotals = {
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
  bet?: SettledBet;
  allocation?: StakeAllocation;
};

export type Check = { label: string; app: number; sheet: number; ok: boolean };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

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

/** Start of week n (UTC): the starting date plus 7 x (n - 1) days. */
export function weekStart(t: Tracker, week: number): Date | null {
  if (!t.startDate) return null;
  return new Date(t.startDate.getTime() + (week - 1) * WEEK_MS);
}

function monthKey(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ---------- cut-off and weeks ----------

/**
 * The cut-off: Starting Date + 7 x weeks played, i.e. the first instant after the spreadsheet's last week.
 * Anything recorded in the database (bets, results, fines paid, payments) counts only from this instant on.
 * Re-importing a later spreadsheet moves this forward automatically.
 */
export function cutoffDate(t: Tracker): Date | null {
  if (!t.startDate) return null;
  return new Date(t.startDate.getTime() + t.weekNumbers.length * WEEK_MS);
}

/** The last day covered by the spreadsheet (the day before the cut-off). Used in the dashboard wording. */
export function lastSpreadsheetDay(t: Tracker): Date | null {
  const cutoff = cutoffDate(t);
  return cutoff ? new Date(cutoff.getTime() - DAY_MS) : null;
}

/** The week number that contains `now` (1-based), or 0 before the starting date. */
export function currentWeekNumber(t: Tracker, now: Date): number {
  if (!t.startDate) return 0;
  const diff = now.getTime() - t.startDate.getTime();
  if (diff < 0) return 0;
  return Math.floor(diff / WEEK_MS) + 1;
}

/**
 * Weeks after the cut-off that count so far: the first week after the spreadsheet up to and including the
 * current week. Future weeks are never counted. Empty before the cut-off.
 */
export function postCutoffWeeks(t: Tracker, now: Date): number[] {
  const first = t.weekNumbers.length + 1;
  const last = currentWeekNumber(t, now);
  if (!t.startDate || last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** True unless a payment exception for this member and week says it was missed. */
export function isPaid(exceptions: readonly PaymentException[], member: string, week: number): boolean {
  const e = exceptions.find((x) => x.member === member && x.weekNumber === week);
  return !e || e.paid;
}

/** Outcome of a result entered by hand: won if returns > stake, void if equal, otherwise lost. */
export function resultOutcome(stake: number, returns: number): SettledStatus {
  const diff = round2(returns - stake);
  if (diff > 0) return "settled_won";
  if (diff === 0) return "settled_void";
  return "settled_lost";
}

// ---------- ledger ----------

export function emptyLedger(): Ledger {
  return {
    cutoff: null,
    postWeeks: [],
    bets: [],
    allocations: [],
    paidMemberWeeks: 0,
    payments: [],
    finesPaid: 0,
    finesOverdue: 0,
    finesByMember: {},
  };
}

/**
 * Works out everything recorded after the cut-off, as at `now`.
 *  - Bets: settled on or after the cut-off (queue bets and results).
 *  - Payments: each member pays every post-cut-off week (up to now) unless a missed-payment exception says otherwise.
 *    Exceptions for weeks outside that range (before the cut-off or in the future) are ignored.
 *  - Fines: paid on or after the cut-off count as paid; unpaid fines given on or after the cut-off count as overdue.
 */
export function buildLedger(t: Tracker, now: Date, input: LedgerInput): Ledger {
  const cutoff = cutoffDate(t);
  if (!cutoff) return emptyLedger();
  const postWeeks = postCutoffWeeks(t, now);
  const members = t.members.map((m) => m.name);
  const known = new Set(members);
  const counted = new Set(postWeeks);

  const bets = input.bets
    .filter((b) => b.settledAt.getTime() >= cutoff.getTime())
    .sort((a, b) => a.settledAt.getTime() - b.settledAt.getTime());

  const missed = new Set(
    input.payments
      .filter((p) => !p.paid && known.has(p.member) && counted.has(p.weekNumber))
      .map((p) => `${p.member}|${p.weekNumber}`),
  );

  const payments: MemberPayments[] = members.map((member) => {
    const missedWeeks = postWeeks.filter((w) => missed.has(`${member}|${w}`)).length;
    const paidWeeks = postWeeks.length - missedWeeks;
    return { member, paidWeeks, missedWeeks, paidAmount: paidWeeks * WEEKLY_PAYMENT };
  });

  const allocations: StakeAllocation[] = postWeeks.map((week) => {
    const paidMembers = members.filter((m) => !missed.has(`${m}|${week}`)).length;
    return { week, start: weekStart(t, week), paidMembers, amount: paidMembers * WEEKLY_STAKE };
  });

  let finesPaid = 0;
  let finesOverdue = 0;
  const finesByMember: FinesByMember = {};
  for (const f of input.fines) {
    const entry = finesByMember[f.member] ?? { paid: 0, overdue: 0 };
    finesByMember[f.member] = entry;
    if (f.paidAt) {
      if (f.paidAt.getTime() >= cutoff.getTime()) {
        finesPaid += f.amount;
        entry.paid += f.amount;
      }
    } else if (f.fineDate.getTime() >= cutoff.getTime()) {
      finesOverdue += f.amount;
      entry.overdue += f.amount;
    }
  }

  return {
    cutoff,
    postWeeks,
    bets,
    allocations,
    paidMemberWeeks: payments.reduce((s, p) => s + p.paidWeeks, 0),
    payments,
    finesPaid: round2(finesPaid),
    finesOverdue: round2(finesOverdue),
    finesByMember,
  };
}

/** Settled bets grouped by proposer. Each proposer is matched to a member name from the sheet, case-insensitively. */
export function byProposer(t: Tracker, bets: SettledBet[]): ProposerTotals[] {
  const memberByKey = new Map(t.members.map((m) => [m.name.trim().toLowerCase(), m.name]));
  const blank = (name: string): ProposerTotals => ({ name, bets: 0, won: 0, lost: 0, void: 0, staked: 0, returns: 0 });
  const rows = new Map<string, ProposerTotals>(t.members.map((m) => [m.name, blank(m.name)]));
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

/** The most recently settled bets, newest first. */
export function recentSettled(bets: SettledBet[], n = 10): SettledBet[] {
  return [...bets].sort((a, b) => b.settledAt.getTime() - a.settledAt.getTime()).slice(0, n);
}

// ---------- totals ----------

/**
 * Totals and KPIs. Pass emptyLedger() (or omit it) for spreadsheet-only figures. Returns null if the sheet's
 * paid-in figure or target is missing.
 *
 * Money model (the sheet's own convention, extended to the post-cut-off ledger):
 *   - Each paid member-week after the cut-off brings in WEEKLY_PAYMENT (5). WEEKLY_BANKED (2.50) of it is banked
 *     and WEEKLY_STAKE (2.50) is allocated to staking. So paid in and staked both rise by the allocation, and
 *     paid in minus banked = staked holds for the sheet and for the ledger.
 *   - Bets are funded from that weekly stake. A queue bet or result does NOT reduce the pot or staked again:
 *     its stake was already allocated when the payment came in. Only its returns move money: they add to punts.
 *     Stakes placed are reported separately (placedStakes) so the leader can see when they exceed the allocation.
 *   - Fines paid after the cut-off add to fines; unpaid fines given after the cut-off add to overdue (not to the pot).
 *
 * Pot = banked + punts + fines + interest, which is the sheet's "Overall" formula. Equivalently
 *   pot = paid in - staked + punts + fines + interest.
 * Overall P&L = pot - paid in = bet P&L + fines + interest, so the identity holds.
 *
 * Average pot per week and the projected target date use the spreadsheet's own pot and weeks, so they describe
 * the spreadsheet's pace. Progress to target uses the full pot.
 */
export function computeStats(t: Tracker, ledger: Ledger = emptyLedger()): Stats | null {
  if (t.paidIn === null || t.target === null) return null;
  const weeks = t.weekNumbers.length;
  const members = t.members.length;
  const weekIdx = Array.from({ length: weeks }, (_, i) => i);

  const sheetPunts = t.members.reduce((s, m) => s + m.punts.reduce((a, b) => a + b, 0), 0);
  const sheetBanked = t.members.reduce((s, m) => s + m.banked.reduce((a, b) => a + b, 0), 0);
  const sheetFines = t.members.reduce((s, m) => s + m.fines, 0);
  const sheetOverdue = t.members.reduce((s, m) => s + m.overdue, 0);
  const interest = t.summary.get("Intrest updated") ?? 0;
  const sheetPot = sheetBanked + sheetPunts + sheetFines + interest;

  const pmw = ledger.paidMemberWeeks;
  const allocated = ledger.allocations.reduce((s, a) => s + a.amount, 0);
  const paidIn = t.paidIn + WEEKLY_PAYMENT * pmw;
  const banked = sheetBanked + WEEKLY_BANKED * pmw;
  const staked = t.paidIn - sheetBanked + allocated;

  const settledReturns = ledger.bets.reduce((s, b) => s + b.returns, 0);
  const placedStakes = ledger.bets.reduce((s, b) => s + b.placedStake, 0);
  const settledWon = ledger.bets.filter((b) => b.status === "settled_won").length;
  const settledLost = ledger.bets.filter((b) => b.status === "settled_lost").length;
  const settledVoid = ledger.bets.filter((b) => b.status === "settled_void").length;

  const punts = sheetPunts + settledReturns;
  const fines = sheetFines + ledger.finesPaid;
  const overdue = sheetOverdue + ledger.finesOverdue;
  const pot = banked + punts + fines + interest;
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

  const decided = settledWon + settledLost;
  return {
    members,
    weeks,
    postWeeks: ledger.postWeeks.length,
    paidMemberWeeks: pmw,
    paidIn,
    banked,
    punts,
    staked,
    placedStakes,
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
    settledBets: ledger.bets.length,
    settledWon,
    settledLost,
    settledVoid,
    settledReturns,
    strikeRate: decided ? settledWon / decided : null,
  };
}

// ---------- series and breakdowns ----------

/** One point per sheet week, with cumulative bet P&L (spreadsheet only). */
export function weeklySeries(t: Tracker): WeekPoint[] {
  // The sheet's paid in is shared evenly across its weeks; this matches the sheet's own staked figure in total.
  const paidInPerWeek = t.weekNumbers.length && t.paidIn !== null ? t.paidIn / t.weekNumbers.length : 0;
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
 * Cumulative bet P&L in date order: the sheet's weeks, then after the cut-off each week's stake allocation
 * (a step down) and each settled bet (its returns, a step up). The last point equals computeStats().betPnl.
 */
export function cumulativeSeries(
  weeks: WeekPoint[],
  bets: SettledBet[],
  allocations: StakeAllocation[] = [],
): CumulativePoint[] {
  const points: CumulativePoint[] = weeks.map((w) => ({ x: `Wk ${w.week}`, cum: w.cumBetPnl, week: w }));
  type Event = { at: number; apply: (cum: number) => number; point: Omit<CumulativePoint, "cum"> };
  const events: Event[] = [
    ...allocations.map((a) => ({
      at: a.start?.getTime() ?? 0,
      apply: (cum: number) => cum - a.amount,
      point: { x: `Wk ${a.week} stakes`, allocation: a },
    })),
    ...bets.map((b) => ({
      at: b.settledAt.getTime(),
      apply: (cum: number) => cum + b.returns,
      point: { x: "", bet: b },
    })),
  ].sort((a, b) => a.at - b.at);
  let cum = weeks.at(-1)?.cumBetPnl ?? 0;
  let betNo = 0;
  for (const e of events) {
    cum = round2(e.apply(cum));
    if (e.point.bet) {
      betNo += 1;
      points.push({ ...e.point, x: `Bet ${betNo}`, cum });
    } else {
      points.push({ ...e.point, cum });
    }
  }
  return points;
}

/**
 * Weekly points grouped by calendar month. Settled bets count their returns in the month they settled.
 * Stake allocations after the cut-off count as staked in the month of their week.
 */
export function monthlySeries(
  weeks: WeekPoint[],
  bets: SettledBet[] = [],
  allocations: StakeAllocation[] = [],
): MonthPoint[] {
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
  for (const a of allocations) {
    const key = monthKey(a.start);
    if (!key) continue;
    const m = monthFor(key);
    m.staked += a.amount;
    m.betPnl -= a.amount;
  }
  for (const b of bets) {
    const key = monthKey(b.settledAt);
    if (!key) continue;
    const m = monthFor(key);
    m.punts += b.returns;
    m.betPnl += b.returns;
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Per-member figures. The pot is split equally; paid in follows each member's own post-cut-off payments. */
export function memberStats(t: Tracker, s: Stats, ledger: Ledger = emptyLedger()): MemberStat[] {
  const potShare = s.members ? s.pot / s.members : 0;
  const sheetPaidShare = s.members ? (t.paidIn ?? 0) / s.members : 0;
  const attributed = new Map(byProposer(t, ledger.bets).map((a) => [a.name, a.returns]));
  const paidWeeks = new Map(ledger.payments.map((p) => [p.member, p.paidWeeks]));
  return t.members
    .map((m) => {
      const sheetPunts = m.punts.reduce((a, b) => a + b, 0);
      const queueReturns = attributed.get(m.name) ?? 0;
      const pw = paidWeeks.get(m.name) ?? 0;
      const sheetBanked = m.banked.reduce((a, b) => a + b, 0);
      const fines = ledger.finesByMember[m.name];
      const paidIn = sheetPaidShare + WEEKLY_PAYMENT * pw;
      return {
        name: m.name,
        punts: sheetPunts + queueReturns,
        queueReturns,
        puntsShare: s.punts ? (sheetPunts + queueReturns) / s.punts : 0,
        weeksWithReturn: m.punts.filter((p) => p > 0).length,
        bestPunt: Math.max(0, ...m.punts),
        fines: m.fines + (fines?.paid ?? 0),
        overdue: m.overdue + (fines?.overdue ?? 0),
        banked: sheetBanked + WEEKLY_BANKED * pw,
        paidIn,
        potShare,
        pnl: potShare - paidIn,
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
