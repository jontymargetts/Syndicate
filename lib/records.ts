// Server-only: database reads and writes for payments, results, fines and the bets feeding the figures.
// Uses lib/db.ts for the connection and schema, and parameterised queries only.

import { type Sql, getDatabaseUrl, readyDb, rowToBet, toIso, toNum } from "@/lib/db";
import { type SettledStatus, isSettledStatus } from "@/lib/bets";
import { dayToDate, type FineInput, type PaymentInput, type ResultInput } from "@/lib/entries";
import { type FineRecord, type LedgerInput, type PaymentException, type SettledBet, resultOutcome } from "@/lib/stats";

type Row = Record<string, unknown>;

export type ResultRow = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  member: string;
  description: string;
  stake: number;
  returns: number;
  notes: string;
  outcome: SettledStatus;
};

export type FineRow = {
  id: string;
  member: string;
  amount: number;
  reason: string;
  /** YYYY-MM-DD */
  date: string;
  paidAt: string | null;
};

export type PaymentRow = PaymentException & { updatedAt: string | null };

// ---------- reads for the figures ----------

/**
 * Everything recorded that the figures may use: settled queue bets, results, missed or re-ticked payments and fines.
 * Returns null when no database is configured or the queries fail. The pages then show spreadsheet figures only.
 * The cut-off and the weeks are applied later, in buildLedger (lib/stats.ts).
 */
export async function fetchLedgerData(): Promise<LedgerInput | null> {
  if (!getDatabaseUrl()) return null;
  try {
    const sql = await readyDb();
    const [betRows, resultRows, paymentRows, fineRows] = await Promise.all([
      sql.query(
        `select * from bets
         where status in ('won','lost','void') and settled_at is not null
           and placed_odds is not null and placed_stake is not null
         order by settled_at asc`,
        [],
      ) as Promise<Row[]>,
      sql.query(
        `select id, to_char(result_date, 'YYYY-MM-DD') as result_date, member, description, stake, returns
         from results`,
        [],
      ) as Promise<Row[]>,
      sql.query(`select member, week_number, paid, note from payments`, []) as Promise<Row[]>,
      sql.query(
        `select id, member, amount, reason, to_char(fine_date, 'YYYY-MM-DD') as fine_date, paid_at from fines`,
        [],
      ) as Promise<Row[]>,
    ]);

    const queueBets: SettledBet[] = [];
    for (const row of betRows) {
      const bet = rowToBet(row);
      if (!isSettledStatus(bet.status)) continue;
      if (bet.placedOdds === undefined || bet.placedStake === undefined || bet.returns === undefined || !bet.settledAt) {
        continue;
      }
      queueBets.push({
        id: bet.id,
        source: "queue",
        event: bet.event,
        selection: bet.selection,
        proposedBy: bet.proposedBy,
        status: bet.status,
        placedOdds: bet.placedOdds,
        placedStake: bet.placedStake,
        returns: bet.returns,
        settledAt: new Date(bet.settledAt),
      });
    }

    const results: SettledBet[] = resultRows.map((row) => {
      const stake = toNum(row.stake) ?? 0;
      const returns = toNum(row.returns) ?? 0;
      return {
        id: String(row.id),
        source: "result",
        event: row.description ? String(row.description) : "Result",
        selection: "",
        proposedBy: String(row.member),
        status: resultOutcome(stake, returns),
        placedStake: stake,
        returns,
        settledAt: dayToDate(String(row.result_date)),
      };
    });

    const payments: PaymentException[] = paymentRows.map((row) => ({
      member: String(row.member),
      weekNumber: Number(row.week_number),
      paid: row.paid === true,
      note: row.note == null ? "" : String(row.note),
    }));

    const fines: FineRecord[] = fineRows.map((row) => {
      const paidAt = toIso(row.paid_at);
      return {
        id: String(row.id),
        member: String(row.member),
        amount: toNum(row.amount) ?? 0,
        reason: row.reason == null ? "" : String(row.reason),
        fineDate: dayToDate(String(row.fine_date)),
        paidAt: paidAt ? new Date(paidAt) : null,
      };
    });

    return { bets: [...queueBets, ...results], payments, fines };
  } catch (err) {
    console.error("Ledger unavailable; showing spreadsheet figures only:", err);
    return null;
  }
}

/**
 * Runs a read for a page. Returns null when no database is configured or the query fails (the failure is logged),
 * so the page can show its "not connected" message instead of crashing.
 */
export async function fetchTable<T>(load: (sql: Sql) => Promise<T>): Promise<T | null> {
  if (!getDatabaseUrl()) return null;
  try {
    return await load(await readyDb());
  } catch (err) {
    console.error("Database read failed:", err);
    return null;
  }
}

// ---------- lists for the pages ----------

export async function listPayments(sql: Sql): Promise<PaymentRow[]> {
  const rows = (await sql.query(
    `select member, week_number, paid, note, updated_at from payments order by week_number desc, member asc`,
    [],
  )) as Row[];
  return rows.map((row) => ({
    member: String(row.member),
    weekNumber: Number(row.week_number),
    paid: row.paid === true,
    note: row.note == null ? "" : String(row.note),
    updatedAt: toIso(row.updated_at) ?? null,
  }));
}

function toResultRow(row: Row): ResultRow {
  const stake = toNum(row.stake) ?? 0;
  const returns = toNum(row.returns) ?? 0;
  return {
    id: String(row.id),
    date: String(row.result_date),
    member: String(row.member),
    description: row.description == null ? "" : String(row.description),
    stake,
    returns,
    notes: row.notes == null ? "" : String(row.notes),
    outcome: resultOutcome(stake, returns),
  };
}

export async function listResults(sql: Sql): Promise<ResultRow[]> {
  const rows = (await sql.query(
    `select id, to_char(result_date, 'YYYY-MM-DD') as result_date, member, description, stake, returns, notes
     from results order by result_date desc, created_at desc limit 1000`,
    [],
  )) as Row[];
  return rows.map(toResultRow);
}

function toFineRow(row: Row): FineRow {
  return {
    id: String(row.id),
    member: String(row.member),
    amount: toNum(row.amount) ?? 0,
    reason: row.reason == null ? "" : String(row.reason),
    date: String(row.fine_date),
    paidAt: toIso(row.paid_at) ?? null,
  };
}

export async function listFines(sql: Sql): Promise<FineRow[]> {
  const rows = (await sql.query(
    `select id, member, amount, reason, to_char(fine_date, 'YYYY-MM-DD') as fine_date, paid_at
     from fines order by fine_date desc, created_at desc limit 1000`,
    [],
  )) as Row[];
  return rows.map(toFineRow);
}

// ---------- writes ----------

export async function upsertPayment(sql: Sql, p: PaymentInput): Promise<void> {
  await sql.query(
    `insert into payments (member, week_number, paid, note, updated_at)
     values ($1, $2, $3, $4, now())
     on conflict (member, week_number)
     do update set paid = excluded.paid, note = excluded.note, updated_at = now()`,
    [p.member, p.weekNumber, p.paid, p.note || null],
  );
}

/** Inserts all rows in one statement (all or nothing). */
export async function insertResults(sql: Sql, rows: ResultInput[]): Promise<number> {
  const params: unknown[] = [];
  const tuples = rows.map((r) => {
    const i = params.length;
    params.push(r.date, r.member, r.description || null, r.stake, r.returns, r.notes || null);
    return `($${i + 1}::date, $${i + 2}, $${i + 3}, $${i + 4}::numeric, $${i + 5}::numeric, $${i + 6})`;
  });
  await sql.query(
    `insert into results (result_date, member, description, stake, returns, notes) values ${tuples.join(", ")}`,
    params,
  );
  return rows.length;
}

export async function deleteResult(sql: Sql, id: string): Promise<boolean> {
  const rows = (await sql.query("delete from results where id = $1 returning id", [id])) as Row[];
  return rows.length > 0;
}

export async function insertFine(sql: Sql, f: FineInput): Promise<FineRow> {
  const rows = (await sql.query(
    `insert into fines (member, amount, reason, fine_date)
     values ($1, $2::numeric, $3, $4::date)
     returning id, member, amount, reason, to_char(fine_date, 'YYYY-MM-DD') as fine_date, paid_at`,
    [f.member, f.amount, f.reason || null, f.date],
  )) as Row[];
  return toFineRow(rows[0]);
}

/** Marks a fine paid (paid_at = now) or unpaid (paid_at cleared). Returns null if there is no such fine. */
export async function setFinePaid(sql: Sql, id: string, paid: boolean): Promise<FineRow | null> {
  const rows = (await sql.query(
    `update fines
     set paid_at = case when $2::boolean then coalesce(paid_at, now()) else null end
     where id = $1
     returning id, member, amount, reason, to_char(fine_date, 'YYYY-MM-DD') as fine_date, paid_at`,
    [id, paid],
  )) as Row[];
  return rows[0] ? toFineRow(rows[0]) : null;
}

export async function deleteFine(sql: Sql, id: string): Promise<boolean> {
  const rows = (await sql.query("delete from fines where id = $1 returning id", [id])) as Row[];
  return rows.length > 0;
}

/** Deletes a queue bet. A deleted bet drops out of every figure, since the figures read the table. */
export async function deleteBet(sql: Sql, id: string): Promise<boolean> {
  const rows = (await sql.query("delete from bets where id = $1 returning id", [id])) as Row[];
  return rows.length > 0;
}
