// Bet queue domain logic. Pure functions only, so they can be used from client components,
// route handlers and plain Node scripts (scripts/check-stats.mts imports this file).
//
// The shared queue is stored in Postgres behind /api/bets (see lib/db.ts). Without a database the
// queue falls back to the browser's localStorage (see components/BetQueue.tsx).

export const STATUSES = [
  "proposed",
  "approved",
  "placed",
  "settled_won",
  "settled_lost",
  "settled_void",
] as const;

export type BetStatus = (typeof STATUSES)[number];

export type SettledStatus = "settled_won" | "settled_lost" | "settled_void";

export const SETTLED_STATUSES: readonly SettledStatus[] = ["settled_won", "settled_lost", "settled_void"];

export function isSettledStatus(status: BetStatus): status is SettledStatus {
  return (SETTLED_STATUSES as readonly BetStatus[]).includes(status);
}

export const STATUS_LABEL: Record<BetStatus, string> = {
  proposed: "Proposed",
  approved: "Approved",
  placed: "Placed",
  settled_won: "Settled: Won",
  settled_lost: "Settled: Lost",
  settled_void: "Settled: Void",
};

export type Bet = {
  id: string;
  event: string;
  selection: string;
  market: string;
  odds: number; // decimal odds as proposed
  stake: number; // proposed stake (GBP)
  notes: string;
  proposedBy: string;
  createdAt: string; // ISO timestamp
  status: BetStatus;
  // Filled in by the leader when the bet is actually placed on bet365.
  placedOdds?: number;
  placedStake?: number;
  placedAt?: string;
  // Filled in when the bet settles. returns is the total paid back, stake included (GBP).
  settledAt?: string;
  returns?: number;
};

export const STORAGE_KEY = "syndicate.betQueue.v1";

/** Stake (GBP) pre-filled in the propose and placed forms. The leader can change it. */
export const DEFAULT_STAKE = 2.5;

export function newId(): string {
  return `bet_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function potentialReturn(stake: number, odds: number): number {
  return stake * odds;
}

export function formatMoney(n: number | undefined): string {
  if (n === undefined || Number.isNaN(n)) return "-";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
}

// Plain-text summary used by the "Copy bet details" button.
export function betSummary(bet: Bet): string {
  const placed =
    bet.placedOdds !== undefined || bet.placedStake !== undefined
      ? `\nPlaced at: ${bet.placedOdds ?? "-"} odds, ${formatMoney(bet.placedStake)}`
      : "";
  return [
    `Syndicate bet (${STATUS_LABEL[bet.status]})`,
    `Event: ${bet.event}`,
    `Market: ${bet.market || "-"}`,
    `Selection: ${bet.selection}`,
    `Odds: ${bet.odds}`,
    `Stake: ${formatMoney(bet.stake)}`,
    `Proposed by: ${bet.proposedBy || "-"}`,
    bet.notes ? `Notes: ${bet.notes}` : null,
  ]
    .filter(Boolean)
    .join("\n") + placed;
}

export function isValidBetInput(input: { event: string; selection: string; odds: number; stake: number }): string | null {
  if (!input.event.trim()) return "Event is required.";
  if (!input.selection.trim()) return "Selection is required.";
  if (!Number.isFinite(input.odds) || input.odds <= 1) return "Odds must be a decimal number greater than 1.00.";
  if (!Number.isFinite(input.stake) || input.stake <= 0) return "Stake must be greater than 0.";
  return null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Decimal odds from either decimal ("2.50") or fractional ("5/2") input, rounded to 2 dp.
 * 5/2 is 1 + 5/2 = 3.50. Returns null if the input cannot be read as odds greater than 0.
 */
export function parseOdds(raw: unknown): number | null {
  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim();
    const fraction = /^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/.exec(s);
    if (fraction) {
      const denominator = Number(fraction[2]);
      if (denominator <= 0) return null;
      value = 1 + Number(fraction[1]) / denominator;
    } else if (/^\d+(?:\.\d+)?$/.test(s)) {
      value = Number(s);
    } else {
      return null;
    }
  } else {
    return null;
  }
  return Number.isFinite(value) ? round2(value) : null;
}

/**
 * The returns a settled bet pays back, stake included, when the leader does not enter one:
 *   won  -> placed stake x placed odds (decimal)
 *   lost -> 0
 *   void -> placed stake refunded
 * Profit on a bet is returns minus placed stake.
 */
export function autoReturns(status: SettledStatus, placedStake: number, placedOdds: number): number {
  if (status === "settled_won") return round2(placedStake * placedOdds);
  if (status === "settled_void") return round2(placedStake);
  return 0;
}

export type ReturnsResult = { ok: true; value: number } | { ok: false; error: string };

/**
 * Returns to store when settling. An entered override (e.g. each-way or cash-out) is checked:
 *   won  -> 0 up to stake x odds (a winning bet cannot pay more than that)
 *   lost -> exactly 0
 *   void -> exactly the placed stake
 */
export function resolveReturns(input: {
  status: SettledStatus;
  placedStake: number;
  placedOdds: number;
  override?: number;
}): ReturnsResult {
  const { status, placedStake, placedOdds, override } = input;
  if (override === undefined) return { ok: true, value: autoReturns(status, placedStake, placedOdds) };
  if (!Number.isFinite(override) || override < 0) return { ok: false, error: "Returns must be a number, 0 or more." };
  const value = round2(override);
  if (status === "settled_lost") {
    if (value !== 0) return { ok: false, error: "A lost bet returns £0.00." };
  } else if (status === "settled_void") {
    const stake = round2(placedStake);
    if (Math.abs(value - stake) > 0.005) return { ok: false, error: `A void bet returns its stake (${formatMoney(stake)}).` };
  } else {
    const max = round2(placedStake * placedOdds);
    if (value > max + 0.005) {
      return { ok: false, error: `A winning bet cannot return more than stake x odds (${formatMoney(max)}).` };
    }
  }
  return { ok: true, value };
}

// Which leader action is valid from each status.
export const NEXT_ACTIONS: Record<BetStatus, Array<"approve" | "place" | "settle_won" | "settle_lost" | "settle_void">> = {
  proposed: ["approve"],
  approved: ["place"],
  placed: ["settle_won", "settle_lost", "settle_void"],
  settled_won: [],
  settled_lost: [],
  settled_void: [],
};
