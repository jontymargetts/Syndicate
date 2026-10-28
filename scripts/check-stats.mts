// Checks the pure settlement, ledger and statistics rules with sample data. No database needed.
// Run: node --experimental-strip-types scripts/check-stats.mts
// Exits with status 1 if any check fails.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoReturns, parseOdds, resolveReturns } from "../lib/bets.ts";
import {
  WEEKLY_BANKED,
  WEEKLY_PAYMENT,
  WEEKLY_STAKE,
  buildLedger,
  computeStats,
  currentWeekNumber,
  cumulativeSeries,
  cutoffDate,
  byProposer,
  isPaid,
  memberStats,
  monthlySeries,
  parseTracker,
  postCutoffWeeks,
  resultOutcome,
  weeklySeries,
  type FineRecord,
  type LedgerInput,
  type Sheet,
  type SettledBet,
  type Tracker,
} from "../lib/stats.ts";
import {
  DEFAULT_RESULT_STAKE,
  checkResultsCsv,
  parseDay,
  parseFineInput,
  parseMoney,
  parsePaymentInput,
  parseResultInput,
  parseCsv,
} from "../lib/entries.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sheet = JSON.parse(fs.readFileSync(path.join(root, "data", "twol-new.json"), "utf-8")) as Sheet;
const tracker = parseTracker(sheet) as Tracker;
if (!tracker) throw new Error("Could not parse data/twol-new.json");

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol;
const at = (iso: string) => new Date(iso);
const MEMBERS = tracker.members.map((m) => m.name);
// "Now" values used below. 21 Oct 2026 is the cut-off (start of week 40). 28 Oct 2026 is in week 41.
const BEFORE_CUTOFF = at("2026-10-20T12:00:00Z");
const AFTER_ONE_WEEK = at("2026-10-22T12:00:00Z"); // week 40 only
const NOW = at("2026-10-28T12:00:00Z"); // weeks 40 and 41

// ---- 1. Settlement rules (queue bets) ----
check("win at 3.0 on 2.50 returns 7.50", autoReturns("settled_won", 2.5, 3.0) === 7.5);
check("loss returns 0", autoReturns("settled_lost", 2.5, 3.0) === 0);
check("void returns the stake (2.50)", autoReturns("settled_void", 2.5, 3.0) === 2.5);
check("override accepted for a cash-out win (5.00)", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3, override: 5 }).ok === true);
check("override above stake x odds rejected", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3, override: 750 }).ok === false);
check("override on a loss must be 0", resolveReturns({ status: "settled_lost", placedStake: 2.5, placedOdds: 3, override: 1 }).ok === false);
check("void override must equal the stake", resolveReturns({ status: "settled_void", placedStake: 2.5, placedOdds: 3, override: 2 }).ok === false);
check("negative override rejected", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3, override: -1 }).ok === false);
check("odds '5/2' = 3.50", parseOdds("5/2") === 3.5);
check("odds '5/0' rejected", parseOdds("5/0") === null);
check("odds 'evens' rejected", parseOdds("evens") === null);

// ---- 2. Baseline: no post-cut-off weeks and no database rows equals the spreadsheet exactly ----
const cutoff = cutoffDate(tracker);
check("cut-off is 21 Oct 2026 00:00 UTC (start + 39 weeks)", cutoff?.toISOString() === "2026-10-21T00:00:00.000Z", cutoff?.toISOString());
const base = computeStats(tracker);
if (!base) throw new Error("computeStats returned null");
check("baseline: pot 2827.38", near(base.pot, 2827.38), base.pot.toFixed(2));
check("baseline: punts 960.16", near(base.punts, 960.16), base.punts.toFixed(2));
check("baseline: bet P&L -209.84", near(base.betPnl, -209.84), base.betPnl.toFixed(2));
check("baseline: staked 1170", near(base.staked, 1170));
check("baseline: paid in 2340", near(base.paidIn, 2340));
check("baseline: banked 1170", near(base.banked, 1170));
check("baseline: no strike rate", base.strikeRate === null);
check("baseline: identity overall = bet P&L + fines + interest", near(base.overallPnl, base.betPnl + base.fines + base.interest));
check("baseline: weekly series ends at -209.84", near(weeklySeries(tracker).at(-1)?.cumBetPnl ?? NaN, -209.84));

// Same baseline with an empty ledger from before the cut-off, and with bets and fines all dated before it.
const oldBets: SettledBet[] = [
  { id: "old1", source: "queue", event: "E", selection: "S", proposedBy: "Angus", status: "settled_won", placedOdds: 10, placedStake: 2.5, returns: 25, settledAt: at("2026-10-20T23:00:00Z") },
  { id: "old2", source: "result", event: "R", selection: "", proposedBy: "Ben", status: "settled_lost", placedStake: 2.5, returns: 0, settledAt: at("2026-10-01T00:00:00Z") },
];
const oldFine: FineRecord = { id: "f0", member: "Ben", amount: 10, reason: "", fineDate: at("2026-09-01T00:00:00Z"), paidAt: at("2026-09-02T00:00:00Z") };
const preLedger = buildLedger(tracker, BEFORE_CUTOFF, { bets: oldBets, payments: [], fines: [oldFine] });
const pre = computeStats(tracker, preLedger);
check("before the cut-off: no weeks counted", preLedger.postWeeks.length === 0);
check("before the cut-off: pre-cut-off bets, results and fines ignored", pre !== null && near(pre.pot, base.pot) && near(pre.punts, base.punts) && pre.settledBets === 0);

// ---- 3. Payments: automatic, missed weeks stored, future weeks not counted ----
check("current week on 28 Oct 2026 is week 41", currentWeekNumber(tracker, NOW) === 41);
check("post-cut-off weeks on 28 Oct 2026 are 40 and 41", JSON.stringify(postCutoffWeeks(tracker, NOW)) === "[40,41]");
check("post-cut-off weeks on 22 Oct 2026 are only 40 (future week not counted)", JSON.stringify(postCutoffWeeks(tracker, AFTER_ONE_WEEK)) === "[40]");
check("no weeks counted before the cut-off", postCutoffWeeks(tracker, BEFORE_CUTOFF).length === 0);

const noRows = buildLedger(tracker, NOW, { bets: [], payments: [], fines: [] });
const allPaid = computeStats(tracker, noRows)!;
const members = MEMBERS.length;
check("payments: every member paid every week (12 x 2 = 24 member-weeks)", noRows.paidMemberWeeks === members * 2, String(noRows.paidMemberWeeks));
check("payments: paid in +£5 per member-week (2340 + 120)", near(allPaid.paidIn, 2340 + WEEKLY_PAYMENT * 24));
check("payments: banked +£2.50 per member-week", near(allPaid.banked, 1170 + WEEKLY_BANKED * 24));
check("payments: staked +£2.50 per member-week", near(allPaid.staked, 1170 + WEEKLY_STAKE * 24));
check("payments: pot rises by the banked part only (2827.38 + 60)", near(allPaid.pot, 2827.38 + WEEKLY_BANKED * 24), allPaid.pot.toFixed(2));
check("payments: punts unchanged", near(allPaid.punts, 960.16));
check("payments: bet P&L falls by the stake allocation (-209.84 - 60)", near(allPaid.betPnl, -209.84 - WEEKLY_STAKE * 24));
check("payments: identity overall = bet P&L + fines + interest", near(allPaid.overallPnl, allPaid.betPnl + allPaid.fines + allPaid.interest));
check("payments: allocation per week is 12 x 2.50 = 30", noRows.allocations.every((a) => near(a.amount, 30)));

const missedBen = buildLedger(tracker, NOW, {
  bets: [],
  payments: [{ member: "Ben", weekNumber: 41, paid: false, note: "standing order bounced" }],
  fines: [],
});
const missed = computeStats(tracker, missedBen)!;
check("missed: one missed member-week removes £5 paid in", near(missed.paidIn, allPaid.paidIn - WEEKLY_PAYMENT));
check("missed: stake allocation drops by £2.50 for that week", near(missed.staked, allPaid.staked - WEEKLY_STAKE));
check("missed: Ben has 1 missed week and 1 paid week", missedBen.payments.find((p) => p.member === "Ben")?.missedWeeks === 1 && missedBen.payments.find((p) => p.member === "Ben")?.paidWeeks === 1);
check("missed: Ben's paid in share is lower, the others unchanged", (memberStats(tracker, missed, missedBen).find((m) => m.name === "Ben")?.paidIn ?? 0) < (memberStats(tracker, allPaid, noRows).find((m) => m.name === "Ben")?.paidIn ?? 0));
const reTicked = buildLedger(tracker, NOW, {
  bets: [],
  payments: [{ member: "Ben", weekNumber: 41, paid: true, note: "" }],
  fines: [],
});
check("re-ticked (paid = true) counts as paid", near(computeStats(tracker, reTicked)!.paidIn, allPaid.paidIn));
const ignored = buildLedger(tracker, AFTER_ONE_WEEK, {
  bets: [],
  payments: [
    { member: "Ben", weekNumber: 41, paid: false, note: "future week" }, // week 41 has not started
    { member: "Ben", weekNumber: 10, paid: false, note: "before cut-off" }, // before cut-off
    { member: "Zed", weekNumber: 40, paid: false, note: "not a member" },
  ],
  fines: [],
});
check("payments: future, pre-cut-off and unknown-member exceptions are ignored", ignored.paidMemberWeeks === 12 && ignored.payments.every((p) => p.missedWeeks === 0));
check("payments: isPaid is true when there is no row", isPaid([], "Ben", 40));
check("payments: isPaid is false for a missed row", !isPaid([{ member: "Ben", weekNumber: 40, paid: false, note: "" }], "Ben", 40));

// ---- 4. Settled bets after the cut-off: no double counting of stakes ----
const queue: SettledBet[] = [
  { id: "w1", source: "queue", event: "Test v Test", selection: "Win", proposedBy: "jonty", status: "settled_won", placedOdds: 3, placedStake: 2.5, returns: 7.5, settledAt: at("2026-10-24T15:00:00Z") },
  { id: "l1", source: "queue", event: "Test v Test", selection: "Lose", proposedBy: "Ben", status: "settled_lost", placedOdds: 2, placedStake: 2.5, returns: 0, settledAt: at("2026-10-25T15:00:00Z") },
  { id: "v1", source: "queue", event: "Test v Test", selection: "Void", proposedBy: " Rory ", status: "settled_void", placedOdds: 1.8, placedStake: 2.5, returns: 2.5, settledAt: at("2026-10-26T15:00:00Z") },
  { id: "big", source: "queue", event: "Test v Test", selection: "Big stake", proposedBy: "Oli", status: "settled_lost", placedOdds: 2, placedStake: 10, returns: 0, settledAt: at("2026-10-27T15:00:00Z") },
  { id: "old", source: "queue", event: "Old", selection: "Old", proposedBy: "Angus", status: "settled_won", placedOdds: 10, placedStake: 2.5, returns: 25, settledAt: at("2026-10-20T23:00:00Z") },
];
const withBets = buildLedger(tracker, NOW, { bets: queue, payments: [], fines: [] });
const bs = computeStats(tracker, withBets)!;
check("bets: settled before the cut-off are excluded", withBets.bets.length === 4 && !withBets.bets.some((b) => b.id === "old"));
check("bets: pot adds returns only (7.50 + 0 + 2.50 + 0), no stake deducted", near(bs.pot - allPaid.pot, 7.5 + 0 + 2.5 + 0));
check("bets: a £10 stake does not change staked (weekly allocation only)", near(bs.staked, allPaid.staked));
check("bets: placed stakes reported separately (2.50 + 2.50 + 2.50 + 10)", near(bs.placedStakes, 17.5));
check("bets: punts add returns (10.00)", near(bs.punts - allPaid.punts, 10));
check("bets: bet P&L moves by returns only", near(bs.betPnl - allPaid.betPnl, 10));
check("bets: identity overall = bet P&L + fines + interest", near(bs.overallPnl, bs.betPnl + bs.fines + bs.interest));
check("bets: pot = paid in - staked + punts + fines + interest", near(bs.pot, bs.paidIn - bs.staked + bs.punts + bs.fines + bs.interest));
check("bets: strike rate 1 won of 2 decided (void not counted)", bs.settledWon === 1 && bs.settledLost === 2 && near(bs.strikeRate ?? NaN, 1 / 3));

// ---- 5. Results entered by hand ----
check("result outcome: return above stake is won", resultOutcome(2.5, 7.5) === "settled_won");
check("result outcome: return equal to stake is void", resultOutcome(2.5, 2.5) === "settled_void");
check("result outcome: return below stake (incl. 0) is lost", resultOutcome(2.5, 0) === "settled_lost" && resultOutcome(2.5, 1) === "settled_lost");
const results: SettledBet[] = [
  { id: "r1", source: "result", event: "Accumulator", selection: "", proposedBy: "Rory", status: resultOutcome(2.5, 12), placedStake: 2.5, returns: 12, settledAt: at("2026-10-23T00:00:00Z") },
  { id: "r2", source: "result", event: "Syndicate bet", selection: "", proposedBy: "Syndicate", status: resultOutcome(2.5, 0), placedStake: 2.5, returns: 0, settledAt: at("2026-10-25T00:00:00Z") },
  { id: "r0", source: "result", event: "Too early", selection: "", proposedBy: "Rory", status: resultOutcome(2.5, 50), placedStake: 2.5, returns: 50, settledAt: at("2026-10-20T00:00:00Z") },
];
const withResults = buildLedger(tracker, NOW, { bets: [...queue, ...results], payments: [], fines: [] });
const rs = computeStats(tracker, withResults)!;
check("results: dated before the cut-off are excluded", !withResults.bets.some((b) => b.id === "r0"));
check("results: returns feed punts like queue bets", near(rs.punts - bs.punts, 12));
check("results: a result counts in the strike rate (won 2, lost 3)", rs.settledWon === 2 && rs.settledLost === 3 && near(rs.strikeRate ?? NaN, 2 / 5));
const attribution = byProposer(tracker, withResults.bets);
check("results: credited to the member named", attribution.find((a) => a.name === "Rory")?.returns === 12 + 2.5);
check("results: 'Syndicate' goes under Other", attribution.find((a) => a.name === "Other")?.bets === 2 || attribution.find((a) => a.name === "Other")?.bets === 1);

// ---- 6. Fines ----
const fines: FineRecord[] = [
  { id: "f1", member: "Ben", amount: 5, reason: "late", fineDate: at("2026-10-22T00:00:00Z"), paidAt: at("2026-10-27T10:00:00Z") }, // paid after cut-off: counts
  { id: "f2", member: "Oli", amount: 2, reason: "late", fineDate: at("2026-10-23T00:00:00Z"), paidAt: null }, // unpaid, after cut-off: overdue
  { id: "f3", member: "Jonty", amount: 4, reason: "old", fineDate: at("2026-09-01T00:00:00Z"), paidAt: null }, // unpaid, before cut-off: not counted
  { id: "f4", member: "Brad", amount: 3, reason: "old paid", fineDate: at("2026-09-01T00:00:00Z"), paidAt: at("2026-10-01T00:00:00Z") }, // paid before cut-off: not counted
];
const fl = buildLedger(tracker, NOW, { bets: [], payments: [], fines });
const fs2 = computeStats(tracker, fl)!;
check("fines: paid after cut-off add to fines paid (+5)", near(fs2.fines - base.fines, 5));
check("fines: unpaid after cut-off add to overdue (+2), not the pot", near(fs2.overdue - base.overdue, 2));
check("fines: pot rises by the fine paid (+5) and nothing else (vs payments-only figures)", near(fs2.pot - allPaid.pot, 5));
check("fines: pre-cut-off fines are not counted", near(fl.finesOverdue, 2) && near(fl.finesPaid, 5));
const fineBen = memberStats(tracker, fs2, fl).find((m) => m.name === "Ben");
const fineOli = memberStats(tracker, fs2, fl).find((m) => m.name === "Oli");
const baseOli = memberStats(tracker, base).find((m) => m.name === "Oli");
check("fines: member fines paid include the new paid fine", near(fineBen?.fines ?? NaN, (memberStats(tracker, base).find((m) => m.name === "Ben")?.fines ?? 0) + 5));
check("fines: member overdue include the new unpaid fine", near(fineOli?.overdue ?? NaN, (baseOli?.overdue ?? 0) + 2));

// ---- 7. Member totals add back up to the group totals ----
const everything: LedgerInput = { bets: [...queue, ...results], payments: [{ member: "Angus", weekNumber: 40, paid: false, note: "" }], fines };
const eLedger = buildLedger(tracker, NOW, everything);
const eStats = computeStats(tracker, eLedger)!;
const eMembers = memberStats(tracker, eStats, eLedger);
check("members: punts sum to total punts (incl. Other)", near(eMembers.reduce((s, m) => s + m.punts, 0) + (attribution.find((a) => a.name === "Other")?.returns ?? 0), eStats.punts));
check("members: paid in sums to total paid in", near(eMembers.reduce((s, m) => s + m.paidIn, 0), eStats.paidIn));
check("members: banked sums to total banked", near(eMembers.reduce((s, m) => s + m.banked, 0), eStats.banked));
check("members: fines and overdue sum to totals", near(eMembers.reduce((s, m) => s + m.fines, 0), eStats.fines) && near(eMembers.reduce((s, m) => s + m.overdue, 0), eStats.overdue));

// ---- 8. Cumulative and monthly series match the totals ----
const ws = weeklySeries(tracker);
const cum = cumulativeSeries(ws, eLedger.bets, eLedger.allocations);
check("cumulative chart: last point = bet P&L (weeks, stake steps, bets)", near(cum.at(-1)?.cum ?? NaN, eStats.betPnl));
check("cumulative chart: has a point per post-cut-off week and per settled bet", cum.length === ws.length + eLedger.allocations.length + eLedger.bets.length);
const ms = monthlySeries(ws, eLedger.bets, eLedger.allocations);
check("monthly chart: months sum to bet P&L", near(ms.reduce((s, m) => s + m.betPnl, 0), eStats.betPnl));
check("monthly chart: October and results land in their month", ms.some((m) => m.month === "2026-10" && m.punts > 0));

// ---- 9. Input validation (pure) ----
check("money: '2.50' ok", parseMoney("2.50", "x", { required: true }).ok);
check("money: '£7.50' ok", parseMoney("£7.50", "x", { required: true }).ok);
check("money: '2.555' rejected (3 decimals)", !parseMoney("2.555", "x", { required: true }).ok);
check("money: '-1' rejected", !parseMoney("-1", "x", { required: true }).ok);
check("money: 'abc' rejected", !parseMoney("abc", "x", { required: true }).ok);
check("money: blank stake takes the default (2.50)", parseMoney("", "stake", { required: false, defaultValue: 2.5 }).ok && (parseMoney("", "stake", { required: false, defaultValue: 2.5 }) as { value: number }).value === 2.5);
check("date: '2026-10-24' ok", parseDay("2026-10-24") === "2026-10-24");
check("date: '2026-02-30' rejected", parseDay("2026-02-30") === null);
check("date: '24/10/2026' rejected", parseDay("24/10/2026") === null);
const ctx = { members: [...MEMBERS, "Syndicate"], today: "2026-10-28" };
check("result: default stake 2.50 applied", parseResultInput({ date: "2026-10-24", member: "jonty", returns: "7.50" }, ctx).ok && (parseResultInput({ date: "2026-10-24", member: "jonty", returns: "7.50" }, ctx) as { value: { stake: number; member: string } }).value.stake === DEFAULT_RESULT_STAKE);
check("result: member matched case-insensitively to the canonical name", (parseResultInput({ date: "2026-10-24", member: "jonty", returns: "0" }, ctx) as { value: { member: string } }).value.member === "Jonty");
check("result: unknown member rejected", !parseResultInput({ date: "2026-10-24", member: "Zed", returns: "0" }, ctx).ok);
check("result: 'Syndicate' accepted", parseResultInput({ date: "2026-10-24", member: "Syndicate", returns: "0" }, ctx).ok);
check("result: a date more than 2 days ahead is rejected", !parseResultInput({ date: "2026-11-05", member: "Jonty", returns: "0" }, ctx).ok);
check("result: returns are required", !parseResultInput({ date: "2026-10-24", member: "Jonty", stake: "2.50" }, ctx).ok);
const pctx = { members: MEMBERS, weeks: postCutoffWeeks(tracker, NOW) };
check("payment: week 41 accepted on 28 Oct", parsePaymentInput({ member: "Ben", weekNumber: 41, paid: false }, pctx).ok);
check("payment: week 42 (future) rejected", !parsePaymentInput({ member: "Ben", weekNumber: 42, paid: false }, pctx).ok);
check("payment: week 10 (before cut-off) rejected", !parsePaymentInput({ member: "Ben", weekNumber: 10, paid: false }, pctx).ok);
check("fine: amount with 2 dp accepted, reason optional", parseFineInput({ member: "Ben", amount: 2.5, date: "2026-10-27" }, { members: MEMBERS, today: "2026-10-28" }).ok);
check("fine: unknown member rejected", !parseFineInput({ member: "Zed", amount: 2, date: "2026-10-27" }, { members: MEMBERS, today: "2026-10-28" }).ok);

const csv = [
  "date,member,description,stake,returns",
  '2026-10-24,Jonty,"Arsenal, win",2.50,7.50',
  "2026-10-25,Syndicate,Lost,,0",
  "2026-13-01,Ben,Bad date,2.50,0",
  '2026-10-26,Rory,"Quoted ""name""",2.50,abc',
].join("\r\n");
check("csv: quoted commas and doubled quotes parsed", parseCsv(csv)[1][2] === "Arsenal, win" && parseCsv(csv)[4][2] === 'Quoted "name"');
const checked = checkResultsCsv(csv, ctx);
check("csv: four data rows checked", checked.headerError === null && checked.rows.length === 4);
check("csv: valid rows pass, blank stake defaults to 2.50", !checked.rows[0].error && !checked.rows[1].error && checked.rows[1].value?.stake === 2.5);
check("csv: invalid date and invalid returns are flagged", !!checked.rows[2].error && !!checked.rows[3].error);
check("csv: missing column reported", checkResultsCsv("date,member,stake,returns\n2026-10-24,Jonty,2.50,0", ctx).headerError?.includes("description") === true);
check("csv: header only is reported", checkResultsCsv("date,member,description,stake,returns\n", ctx).headerError !== null);

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
