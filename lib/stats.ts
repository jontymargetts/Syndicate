import type { Row, Sheet, Table } from "./data";

// Pure statistics for the syndicate tracker. No file access here, so this module is safe to import
// from server components, client components and plain Node scripts.
//
// What the spreadsheet actually records (TWOL (New) sheet):
//   - "Punts": each member's weekly returns (what their bets paid back into the pot), per week.
//   - "Banked": each member's weekly banked amount (2.50 per member per week).
//   - "Fines Paid" / "Overdue": per member, totals only (no dates).
//   - "Overall paid" (the sheet's "Invested"): total money paid in by members.
//   - "Intrest updated": interest added to the pot (a single figure).
//   - "Overall" (the pot) = banked + punts + fines + interest. The sheet's own formula.
//
// What it does NOT record: individual bets, stakes, odds, markets, sports or bet types. So strike
// rate, ROI per bet and any sport/market/bet-type breakdowns are not available from this data.
//
// Assumptions (stated on the dashboard):
//   - Staked = paid in minus banked. Each member pays 5.00 a week: 2.50 banked, 2.50 staked.
//     The sheet's own identity (Overall - Invested = punts + fines + interest - staked) supports this.
//   - Week n starts on the "Starting Date" plus 7 * (n - 1) days.
//   - Equal shares: every member pays the same amount, so each member's pot share is pot / members.

const DAY_MS = 86_400_000;

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

export type Stats = {
  members: number;
  weeks: number;
  paidIn: number;
  banked: number;
  punts: number;
  staked: number;
  fines: number;
  overdue: number;
  interest: number;
  pot: number;
  target: number;
  progress: number;
  /** Bet P&L: returns (punts) minus stakes. */
  betPnl: number;
  betRoi: number;
  /** Overall P&L: pot minus paid in (includes fines and interest). */
  overallPnl: number;
  overallRoi: number;
  avgPotPerWeek: number;
  /** Total weeks to reach target at the current average pot per week (includes weeks already played). */
  totalWeeksToTarget: number;
  projectedDate: Date | null;
  /** Member-weeks with a non-zero return. Proxy only: the sheet has no bet-level results. */
  memberWeeksWithReturn: number;
  memberWeeks: number;
  bestPunt: number;
  bestWeek: number;
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
  punts: number;
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
  return new Date(t.startDate.getTime() + (week - 1) * 7 * DAY_MS);
}

function monthKey(d: Date | null): string | null {
  if (!d) return null;
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Totals and KPIs. Returns null if the paid-in figure is missing from the sheet. */
export function computeStats(t: Tracker): Stats | null {
  if (t.paidIn === null || t.target === null) return null;
  const weeks = t.weekNumbers.length;
  const members = t.members.length;
  const weekIdx = Array.from({ length: weeks }, (_, i) => i);

  const punts = t.members.reduce((s, m) => s + m.punts.reduce((a, b) => a + b, 0), 0);
  const banked = t.members.reduce((s, m) => s + m.banked.reduce((a, b) => a + b, 0), 0);
  const fines = t.members.reduce((s, m) => s + m.fines, 0);
  const overdue = t.members.reduce((s, m) => s + m.overdue, 0);
  const interest = t.summary.get("Intrest updated") ?? 0;
  const pot = banked + punts + fines + interest;
  const paidIn = t.paidIn;
  const staked = paidIn - banked;
  const betPnl = punts - staked;
  const overallPnl = pot - paidIn;
  const avgPotPerWeek = weeks ? pot / weeks : 0;
  const totalWeeksToTarget = avgPotPerWeek ? t.target / avgPotPerWeek : 0;
  const projectedDate =
    t.startDate && totalWeeksToTarget
      ? new Date(Math.floor(t.startDate.getTime() + totalWeeksToTarget * 7 * DAY_MS))
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
  };
}

/** One point per played week, with cumulative bet P&L. */
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

/** Weekly points grouped by calendar month of the week start. */
export function monthlySeries(weeks: WeekPoint[]): MonthPoint[] {
  const byMonth = new Map<string, MonthPoint>();
  for (const w of weeks) {
    if (!w.month) continue;
    const m =
      byMonth.get(w.month) ??
      {
        month: w.month,
        label: new Date(`${w.month}-01T00:00:00Z`).toLocaleDateString("en-GB", {
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        }),
        weeks: 0,
        punts: 0,
        staked: 0,
        betPnl: 0,
      };
    m.weeks += 1;
    m.punts += w.punts;
    m.staked += w.staked;
    m.betPnl += w.betPnl;
    byMonth.set(w.month, m);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month));
}

/** Per-member figures. Pot share and paid-in share are equal (every member pays the same). */
export function memberStats(t: Tracker, s: Stats): MemberStat[] {
  const potShare = s.members ? s.pot / s.members : 0;
  const paidShare = s.members ? s.paidIn / s.members : 0;
  return t.members
    .map((m) => {
      const punts = m.punts.reduce((a, b) => a + b, 0);
      const banked = m.banked.reduce((a, b) => a + b, 0);
      return {
        name: m.name,
        punts,
        puntsShare: s.punts ? punts / s.punts : 0,
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

/** Compares our totals with the spreadsheet's own cells. Only rows where the sheet has a value are included. */
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
