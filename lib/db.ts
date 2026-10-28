// Server-only database access: connection, schema bootstrap and the bet queue. Imported only by server code
// (app/api/* route handlers and lib/records.ts).
// Uses the Neon serverless HTTP driver with parameterised queries only.
//
// NOTE: SCHEMA_STATEMENTS mirrors db/schema.sql. Keep the two in step.
// Queries for payments, results and fines live in lib/records.ts.

import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { NextResponse } from "next/server";
import {
  type Bet,
  type BetStatus,
  STATUSES,
  autoReturns,
  isSettledStatus,
  parseOdds,
  resolveReturns,
} from "@/lib/bets";

export type Sql = NeonQueryFunction<false, false>;
type Row = Record<string, unknown>;

const SCHEMA_STATEMENTS = [
  `create table if not exists bets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  proposed_by text not null,
  event text not null,
  market text,
  selection text not null,
  odds numeric(10,2),
  stake numeric(12,2),
  notes text,
  status text not null default 'proposed'
    check (status in ('proposed','approved','placed','won','lost','void','rejected')),
  placed_odds numeric(10,2),
  placed_stake numeric(12,2),
  placed_at timestamptz,
  returns numeric(12,2),
  settled_at timestamptz
)`,
  `create index if not exists bets_status_idx on bets(status)`,
  `create index if not exists bets_created_at_idx on bets(created_at desc)`,
  `create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  member text not null,
  week_number integer not null check (week_number >= 1),
  paid boolean not null,
  note text,
  updated_at timestamptz not null default now(),
  unique (member, week_number)
)`,
  `create table if not exists results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  result_date date not null,
  member text not null,
  description text,
  stake numeric(12,2) not null check (stake >= 0),
  returns numeric(12,2) not null check (returns >= 0),
  notes text
)`,
  `create index if not exists results_date_idx on results(result_date)`,
  `create table if not exists fines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  member text not null,
  amount numeric(12,2) not null check (amount >= 0),
  reason text,
  fine_date date not null,
  paid_at timestamptz
)`,
  `create index if not exists fines_fine_date_idx on fines(fine_date)`,
];

// The UI uses settled_* statuses; the database stores won/lost/void.
const DB_STATUS_FOR: Record<BetStatus, string> = {
  proposed: "proposed",
  approved: "approved",
  placed: "placed",
  settled_won: "won",
  settled_lost: "lost",
  settled_void: "void",
};
const APP_STATUS_FOR: Record<string, BetStatus> = {
  proposed: "proposed",
  approved: "approved",
  placed: "placed",
  won: "settled_won",
  lost: "settled_lost",
  void: "settled_void",
};

// Allowed status changes (mirrors the leader actions in lib/bets.ts NEXT_ACTIONS).
const NEXT_STATUS: Partial<Record<BetStatus, BetStatus[]>> = {
  proposed: ["approved"],
  approved: ["placed"],
  placed: ["settled_won", "settled_lost", "settled_void"],
};

export class DatabaseNotConfiguredError extends Error {}

export function getDatabaseUrl(): string | null {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || null;
}

let schemaReady: Promise<void> | null = null;

// Runs the schema once per server instance. On failure the next request retries.
function ensureSchema(sql: Sql): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      for (const statement of SCHEMA_STATEMENTS) {
        await sql.query(statement);
      }
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

// Returns a ready-to-use client, or throws DatabaseNotConfiguredError when no URL is set.
export async function readyDb(): Promise<Sql> {
  const url = getDatabaseUrl();
  if (!url) throw new DatabaseNotConfiguredError("DATABASE_URL is not set");
  const sql = neon(url);
  await ensureSchema(sql);
  return sql;
}

// Standard error mapping for route handlers.
export function dbErrorResponse(err: unknown): NextResponse {
  if (err instanceof DatabaseNotConfiguredError) {
    return NextResponse.json({ error: "database_not_configured" }, { status: 503 });
  }
  console.error("bets API database error:", err);
  return NextResponse.json({ error: "database_error" }, { status: 500 });
}

// ---------- row mapping ----------

export function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function toIso(v: unknown): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (v instanceof Date) return v.toISOString();
  // Postgres text form, e.g. "2026-10-28 10:00:00+00"
  const d = new Date(String(v).replace(" ", "T").replace(/([+-]\d{2})$/, "$1:00"));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function rowToBet(row: Row): Bet {
  const bet: Bet = {
    id: String(row.id),
    event: String(row.event ?? ""),
    market: row.market == null ? "" : String(row.market),
    selection: String(row.selection ?? ""),
    odds: toNum(row.odds) ?? 0,
    stake: toNum(row.stake) ?? 0,
    notes: row.notes == null ? "" : String(row.notes),
    proposedBy: String(row.proposed_by ?? ""),
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    status: APP_STATUS_FOR[String(row.status)] ?? "proposed",
  };
  const placedOdds = toNum(row.placed_odds);
  if (placedOdds !== undefined) bet.placedOdds = placedOdds;
  const placedStake = toNum(row.placed_stake);
  if (placedStake !== undefined) bet.placedStake = placedStake;
  const placedAt = toIso(row.placed_at);
  if (placedAt) bet.placedAt = placedAt;
  const settledAt = toIso(row.settled_at);
  if (settledAt) bet.settledAt = settledAt;
  // Settled bets stored before returns were recorded get the automatic value.
  const returns = toNum(row.returns);
  if (returns !== undefined) bet.returns = returns;
  else if (isSettledStatus(bet.status) && placedOdds !== undefined && placedStake !== undefined) {
    bet.returns = autoReturns(bet.status, placedStake, placedOdds);
  }
  return bet;
}

// ---------- input validation ----------

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

function readText(body: Record<string, unknown>, key: string, opts: { required?: boolean; max: number }): Parsed<string> {
  const raw = body[key];
  if (raw === undefined || raw === null) {
    return opts.required ? { ok: false, error: `${key} is required.` } : { ok: true, value: "" };
  }
  if (typeof raw !== "string") return { ok: false, error: `${key} must be text.` };
  const value = raw.trim();
  if (opts.required && !value) return { ok: false, error: `${key} is required.` };
  if (value.length > opts.max) return { ok: false, error: `${key} must be at most ${opts.max} characters.` };
  return { ok: true, value };
}

// Numbers may be sent as JSON numbers or numeric strings. Bounds: min < value <= max (or >= min when inclusive).
function readNumber(
  body: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; min: number; max: number; minInclusive?: boolean },
): Parsed<number | undefined> {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") {
    return opts.required ? { ok: false, error: `${key} is required.` } : { ok: true, value: undefined };
  }
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  const aboveMin = opts.minInclusive ? n >= opts.min : n > opts.min;
  if (!Number.isFinite(n) || !aboveMin || n > opts.max) {
    const bound = opts.minInclusive ? `at least ${opts.min}` : `greater than ${opts.min}`;
    return { ok: false, error: `${key} must be a number ${bound} and at most ${opts.max}.` };
  }
  return { ok: true, value: n };
}

// Odds may be decimal (2.50 or "2.50") or fractional ("5/2"). Stored as decimal; must be greater than 1.00.
function readOdds(body: Record<string, unknown>, key: string, required: boolean): Parsed<number | undefined> {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") {
    return required ? { ok: false, error: `${key} is required.` } : { ok: true, value: undefined };
  }
  const value = parseOdds(raw);
  if (value === null || value <= 1 || value > 1000) {
    return { ok: false, error: `${key} must be decimal odds (2.50) or fractional odds (5/2), greater than 1.00.` };
  }
  return { ok: true, value };
}

function readDate(body: Record<string, unknown>, key: string): Parsed<string | undefined> {
  const raw = body[key];
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: undefined };
  if (typeof raw !== "string" || Number.isNaN(Date.parse(raw))) return { ok: false, error: `${key} must be an ISO date.` };
  return { ok: true, value: new Date(raw).toISOString() };
}

export type NewBet = {
  event: string;
  market: string;
  selection: string;
  odds: number;
  stake: number;
  notes: string;
  proposedBy: string;
};

export function parseNewBet(body: unknown): Parsed<NewBet> {
  const b = asRecord(body);
  if (!b) return { ok: false, error: "Request body must be a JSON object." };
  const event = readText(b, "event", { required: true, max: 200 });
  if (!event.ok) return event;
  const selection = readText(b, "selection", { required: true, max: 200 });
  if (!selection.ok) return selection;
  const market = readText(b, "market", { max: 200 });
  if (!market.ok) return market;
  const proposedBy = readText(b, "proposedBy", { max: 100 });
  if (!proposedBy.ok) return proposedBy;
  const notes = readText(b, "notes", { max: 2000 });
  if (!notes.ok) return notes;
  const odds = readOdds(b, "odds", true);
  if (!odds.ok) return odds;
  const stake = readNumber(b, "stake", { required: true, min: 0, max: 1_000_000 });
  if (!stake.ok) return stake;
  return {
    ok: true,
    value: {
      event: event.value,
      selection: selection.value,
      market: market.value,
      proposedBy: proposedBy.value,
      notes: notes.value,
      odds: odds.value as number,
      stake: stake.value as number,
    },
  };
}

export type BetPatch = {
  status?: BetStatus;
  placedOdds?: number;
  placedStake?: number;
  placedAt?: string;
  settledAt?: string;
  returns?: number;
};

export function parseBetPatch(body: unknown): Parsed<BetPatch> {
  const b = asRecord(body);
  if (!b) return { ok: false, error: "Request body must be a JSON object." };
  const patch: BetPatch = {};
  if (b.status !== undefined) {
    if (typeof b.status !== "string" || !(STATUSES as readonly string[]).includes(b.status)) {
      return { ok: false, error: `status must be one of: ${STATUSES.join(", ")}.` };
    }
    patch.status = b.status as BetStatus;
  }
  const placedOdds = readOdds(b, "placedOdds", false);
  if (!placedOdds.ok) return placedOdds;
  const placedStake = readNumber(b, "placedStake", { min: 0, max: 1_000_000 });
  if (!placedStake.ok) return placedStake;
  const returns = readNumber(b, "returns", { min: 0, max: 1_000_000, minInclusive: true });
  if (!returns.ok) return returns;
  const placedAt = readDate(b, "placedAt");
  if (!placedAt.ok) return placedAt;
  const settledAt = readDate(b, "settledAt");
  if (!settledAt.ok) return settledAt;
  patch.placedOdds = placedOdds.value;
  patch.placedStake = placedStake.value;
  patch.returns = returns.value;
  patch.placedAt = placedAt.value;
  patch.settledAt = settledAt.value;
  return { ok: true, value: patch };
}

// ---------- queries ----------

export async function listBets(sql: Sql): Promise<Bet[]> {
  const rows = (await sql.query(
    "select * from bets where status <> 'rejected' order by created_at desc limit 500",
    [],
  )) as Row[];
  return rows.map(rowToBet);
}

export async function insertBet(sql: Sql, bet: NewBet): Promise<Bet> {
  const rows = (await sql.query(
    `insert into bets (proposed_by, event, market, selection, odds, stake, notes)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning *`,
    [bet.proposedBy, bet.event, bet.market || null, bet.selection, bet.odds, bet.stake, bet.notes || null],
  )) as Row[];
  return rowToBet(rows[0]);
}

export type UpdateResult =
  | { kind: "ok"; bet: Bet }
  | { kind: "not_found" }
  | { kind: "invalid"; error: string }
  | { kind: "invalid_input"; error: string }
  | { kind: "conflict" };

/**
 * Applies a PATCH. When a bet is settled, returns are set here, on the server:
 *   - no returns in the patch: won = stake x odds, lost = 0, void = stake (see resolveReturns in lib/bets.ts)
 *   - returns in the patch: checked against the same rules (e.g. a win cannot pay more than stake x odds)
 * Returns can only be set on a settled bet, and an already settled bet keeps its returns unless a new value is sent.
 */
export async function updateBet(sql: Sql, id: string, patch: BetPatch): Promise<UpdateResult> {
  const found = (await sql.query("select * from bets where id = $1", [id])) as Row[];
  const current = found[0];
  if (!current) return { kind: "not_found" };

  const currentStatus = APP_STATUS_FOR[String(current.status)];
  if (!currentStatus) return { kind: "invalid", error: "This bet has been rejected and cannot be changed." };

  const nextStatus = patch.status ?? currentStatus;
  if (nextStatus !== currentStatus && !(NEXT_STATUS[currentStatus] ?? []).includes(nextStatus)) {
    return { kind: "invalid", error: `Cannot change status from ${currentStatus} to ${nextStatus}.` };
  }

  const placedOdds = patch.placedOdds ?? toNum(current.placed_odds);
  const placedStake = patch.placedStake ?? toNum(current.placed_stake);
  const settling = isSettledStatus(nextStatus);
  const isPlacedOrLater = nextStatus === "placed" || settling;
  if (isPlacedOrLater && (placedOdds === undefined || placedStake === undefined)) {
    return { kind: "invalid", error: "placedOdds and placedStake are required once a bet is placed." };
  }

  if (patch.returns !== undefined && !settling) {
    return { kind: "invalid_input", error: "returns can only be set when a bet is settled." };
  }

  // Returns are written when the bet settles, or when a settled bet's returns are corrected.
  let returns: number | null = null;
  if (isSettledStatus(nextStatus) && placedOdds !== undefined && placedStake !== undefined) {
    if (nextStatus !== currentStatus || patch.returns !== undefined) {
      const resolved = resolveReturns({ status: nextStatus, placedStake, placedOdds, override: patch.returns });
      if (!resolved.ok) return { kind: "invalid_input", error: resolved.error };
      returns = resolved.value;
    }
  }

  const now = new Date().toISOString();
  const placedAt = patch.placedAt ?? (nextStatus === "placed" && !current.placed_at ? now : null);
  const settledAt = patch.settledAt ?? (settling && !current.settled_at ? now : null);

  // Conditional on the status we read, so a concurrent change yields a conflict instead of a silent overwrite.
  const rows = (await sql.query(
    `update bets set
       status = $2,
       placed_odds = coalesce($3, placed_odds),
       placed_stake = coalesce($4, placed_stake),
       placed_at = coalesce($5, placed_at),
       settled_at = coalesce($6, settled_at),
       returns = coalesce($7, returns),
       updated_at = now()
     where id = $1 and status = $8
     returning *`,
    [
      id,
      DB_STATUS_FOR[nextStatus],
      patch.placedOdds ?? null,
      patch.placedStake ?? null,
      placedAt,
      settledAt,
      returns,
      String(current.status),
    ],
  )) as Row[];
  if (rows.length === 0) return { kind: "conflict" };
  return { kind: "ok", bet: rowToBet(rows[0]) };
}
