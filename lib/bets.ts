// Bet queue domain logic. Pure functions only, so they can be used from client components.
//
// The queue is stored in the browser's localStorage (see components/BetQueue.tsx).
// That means each device/browser has its own queue. To share one queue between
// several people you need a shared database (e.g. Vercel Postgres, Supabase, or
// Vercel KV/Upstash) plus API routes to read/write it. See README.md.

export const STATUSES = [
  "proposed",
  "approved",
  "placed",
  "settled_won",
  "settled_lost",
  "settled_void",
] as const;

export type BetStatus = (typeof STATUSES)[number];

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
  // Filled in when the bet settles.
  settledAt?: string;
};

export const STORAGE_KEY = "syndicate.betQueue.v1";

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

// Which leader action is valid from each status.
export const NEXT_ACTIONS: Record<BetStatus, Array<"approve" | "place" | "settle_won" | "settle_lost" | "settle_void">> = {
  proposed: ["approve"],
  approved: ["place"],
  placed: ["settle_won", "settle_lost", "settle_void"],
  settled_won: [],
  settled_lost: [],
  settled_void: [],
};
