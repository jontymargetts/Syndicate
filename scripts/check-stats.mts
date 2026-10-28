// Checks the pure settlement and statistics functions with sample bets. No database needed.
// Run: node --experimental-strip-types scripts/check-stats.mts
// Exits with status 1 if any check fails.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { autoReturns, parseOdds, resolveReturns, type SettledStatus } from "../lib/bets.ts";
import {
  computeStats,
  cumulativeSeries,
  includedQueueBets,
  memberStats,
  monthlySeries,
  parseTracker,
  queueByProposer,
  queueCutoff,
  weeklySeries,
  type Sheet,
  type SettledQueueBet,
} from "../lib/stats.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sheet = JSON.parse(fs.readFileSync(path.join(root, "data", "twol-new.json"), "utf-8")) as Sheet;
const tracker = parseTracker(sheet);
if (!tracker) throw new Error("Could not parse data/twol-new.json");

let failures = 0;
let passes = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}
const near = (a: number, b: number, tol = 0.005) => Math.abs(a - b) < tol;

// ---- 1. Settlement rules ----
check("win at 3.0 on 2.50 returns 7.50", autoReturns("settled_won", 2.5, 3.0) === 7.5);
check("loss returns 0", autoReturns("settled_lost", 2.5, 3.0) === 0);
check("void returns the stake (2.50)", autoReturns("settled_void", 2.5, 3.0) === 2.5);
check("override accepted for a cash-out win (5.00)", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3, override: 5 }).ok === true);
check("override above stake x odds rejected", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3, override: 750 }).ok === false);
check("override on a loss must be 0", resolveReturns({ status: "settled_lost", placedStake: 2.5, placedOdds: 3, override: 1 }).ok === false);
check("override on a loss of 0 accepted", resolveReturns({ status: "settled_lost", placedStake: 2.5, placedOdds: 3, override: 0 }).ok === true);
check("void override must equal the stake", resolveReturns({ status: "settled_void", placedStake: 2.5, placedOdds: 3, override: 2 }).ok === false);
check("negative override rejected", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3, override: -1 }).ok === false);
check("NaN override rejected", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3, override: NaN }).ok === false);
check("no override uses the automatic value", resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3 }).ok && (resolveReturns({ status: "settled_won", placedStake: 2.5, placedOdds: 3 }) as { value: number }).value === 7.5);
check("odds '5/2' = 3.50", parseOdds("5/2") === 3.5);
check("odds '2.50' = 2.50", parseOdds("2.50") === 2.5);
check("odds '1/4' = 1.25", parseOdds("1/4") === 1.25);
check("odds '5/0' rejected", parseOdds("5/0") === null);
check("odds 'evens' rejected", parseOdds("evens") === null);
check("odds '-2' rejected", parseOdds("-2") === null);

// ---- 2. Empty queue: identical to the spreadsheet figures ----
const cutoff = queueCutoff(tracker);
check("cut-off is 21 Oct 2026 00:00 UTC (start + 39 weeks)", cutoff?.toISOString() === "2026-10-21T00:00:00.000Z", cutoff?.toISOString());
const empty = computeStats(tracker, []);
if (!empty) throw new Error("computeStats returned null");
check("empty queue: pot 2827.38", near(empty.pot, 2827.38), empty.pot.toFixed(2));
check("empty queue: punts 960.16", near(empty.punts, 960.16), empty.punts.toFixed(2));
check("empty queue: bet P&L -209.84", near(empty.betPnl, -209.84), empty.betPnl.toFixed(2));
check("empty queue: staked 1170 (paid in 2340 minus banked 1170)", near(empty.staked, 1170));
check("empty queue: no queue strike rate", empty.queueStrikeRate === null);
check("empty queue: weekly series ends at the spreadsheet bet P&L", near(weeklySeries(tracker, empty).at(-1)?.cumBetPnl ?? NaN, -209.84));

// ---- 3. Sample queue bets ----
const at = (iso: string) => new Date(iso);
function bet(id: string, status: SettledStatus, proposedBy: string, odds: number, stake: number, settled: string): SettledQueueBet {
  const returns = autoReturns(status, stake, odds);
  return { id, event: "Test v Test", selection: "Test", proposedBy, status, placedOdds: odds, placedStake: stake, returns, settledAt: at(settled) };
}
const sample: SettledQueueBet[] = [
  bet("w1", "settled_won", "jonty", 3.0, 2.5, "2026-10-24T15:00:00Z"), // +5.00
  bet("l1", "settled_lost", "Ben", 2.0, 2.5, "2026-10-25T15:00:00Z"), // -2.50
  bet("v1", "settled_void", " Rory ", 1.8, 2.5, "2026-10-26T15:00:00Z"), // 0
  bet("w2", "settled_won", "Zed", 2.5, 5, "2026-11-01T10:00:00Z"), // +7.50, proposer not a member
  bet("old", "settled_won", "Angus", 10, 2.5, "2026-10-20T23:00:00Z"), // before cut-off: excluded
];
const included = includedQueueBets(tracker, sample);
check("cut-off excludes a bet settled on 20 Oct", included.length === 4 && !included.some((b) => b.id === "old"));
check("included bets are in settled order", included.map((b) => b.id).join() === "w1,l1,v1,w2");

const withQueue = computeStats(tracker, included);
if (!withQueue) throw new Error("computeStats returned null");
const expectedNet = 5 - 2.5 + 0 + 7.5; // 10.00
const expectedStaked = 2.5 + 2.5 + 2.5 + 5;
check("queue: staked adds placed stakes", near(withQueue.staked - empty.staked, expectedStaked));
check("queue: punts add returns (7.50 + 0 + 2.50 + 12.50)", near(withQueue.punts - empty.punts, 7.5 + 0 + 2.5 + 12.5));
check("queue: pot += returns - stake (net 5.00 - 2.50 + 0 + 2.50)", near(withQueue.pot - empty.pot, (7.5 - 2.5) + (0 - 2.5) + (2.5 - 2.5) + (12.5 - 5)));
check("queue: bet P&L moves by the same net", near(withQueue.betPnl - empty.betPnl, withQueue.pot - empty.pot));
check("identity: overall P&L = bet P&L + fines + interest", near(withQueue.overallPnl, withQueue.betPnl + withQueue.fines + withQueue.interest));
check("queue strike rate: 2 won of 3 decided (void excluded)", withQueue.queueStrikeRate !== null && near(withQueue.queueStrikeRate, 2 / 3));
check("queue counts: won 2, lost 1, void 1", withQueue.queueWon === 2 && withQueue.queueLost === 1 && withQueue.queueVoid === 1);
check("average pot per week is the spreadsheet's (unchanged)", near(withQueue.avgPotPerWeek, empty.avgPotPerWeek));

const weeks = weeklySeries(tracker, withQueue);
const cum = cumulativeSeries(weeks, included);
check("cumulative chart: weeks then one point per queue bet", cum.length === weeks.length + included.length);
check("cumulative chart: last point = bet P&L", near(cum.at(-1)?.cum ?? NaN, withQueue.betPnl));
check("cumulative chart: queue net is +10.00 after the weeks", near((cum.at(-1)?.cum ?? 0) - (weeks.at(-1)?.cumBetPnl ?? 0), expectedNet));

const attribution = queueByProposer(tracker, included);
const other = attribution.find((a) => a.name === "Other");
const jonty = attribution.find((a) => a.name === "Jonty");
const rory = attribution.find((a) => a.name === "Rory");
check("members: 'jonty' matches Jonty", jonty?.bets === 1 && near(jonty.returns, 7.5));
check("members: ' Rory ' matches Rory (trimmed)", rory?.void === 1);
check("members: unknown proposer goes under Other", other?.bets === 1 && near(other.returns, 12.5));
const ms = memberStats(tracker, withQueue, included);
check("members: attributed punts sum to total punts", near(ms.reduce((s, m) => s + m.punts, 0) + (other?.returns ?? 0), withQueue.punts));
check("months: queue bets land in their settled month", monthlySeries(weeks, included).some((m) => m.month === "2026-11"));

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
