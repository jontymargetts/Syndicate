// Validation for results, fines and payments, and the results CSV format. Pure (no database, no Node APIs):
// the same rules run in the browser (preview before upload) and on the server (the API routes).
// Money is in pounds, at most 2 decimal places. Dates are calendar days written YYYY-MM-DD.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const DEFAULT_RESULT_STAKE = 2.5;
/** The name for results that belong to the syndicate itself. Credited to "Other" in member figures. */
export const SYNDICATE_LABEL = "Syndicate";
/** Most rows accepted in one CSV upload or one bulk POST. */
export const MAX_BULK_ROWS = 500;
/** Dates may be at most this many days after today (time zones and late entry). */
const FUTURE_DAYS_ALLOWED = 2;
const EARLIEST_DAY = "2020-01-01";
const MAX_MONEY = 1_000_000;

export const RESULT_CSV_COLUMNS = ["date", "member", "description", "stake", "returns"] as const;
export const RESULT_CSV_TEMPLATE =
  "date,member,description,stake,returns\n" +
  "2026-10-24,Jonty,Arsenal to win @ 3.00,2.50,7.50\n" +
  "2026-10-25,Syndicate,Accumulator (lost),2.50,0\n";

// ---------- dates ----------

/** A valid calendar day as YYYY-MM-DD, or null. */
export function parseDay(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    return null;
  }
  return s;
}

/** The day as a Date at 00:00 UTC. */
export function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Today's day in UTC as YYYY-MM-DD. */
export function todayDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function addDays(day: string, n: number): string {
  const d = dayToDate(day);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function readDay(raw: unknown, label: string, today: string): Parsed<string> {
  const day = parseDay(raw);
  if (!day) return { ok: false, error: `${label} must be a real date in the form YYYY-MM-DD (for example 2026-10-24).` };
  if (day < EARLIEST_DAY) return { ok: false, error: `${label} is too early.` };
  if (day > addDays(today, FUTURE_DAYS_ALLOWED)) return { ok: false, error: `${label} is more than ${FUTURE_DAYS_ALLOWED} days in the future.` };
  return { ok: true, value: day };
}

// ---------- fields ----------

/** An amount in pounds: a number or text such as "2.50" or "£2.50", 0 or more, at most 2 decimal places. */
export function parseMoney(raw: unknown, label: string, opts: { required: boolean; defaultValue?: number }): Parsed<number> {
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    if (opts.required) return { ok: false, error: `${label} is required.` };
    return { ok: true, value: opts.defaultValue ?? 0 };
  }
  let n: number;
  if (typeof raw === "number") {
    n = raw;
  } else if (typeof raw === "string") {
    const s = raw.trim().replace(/^£/, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, error: `${label} must be an amount in pounds, for example 7.50.` };
    n = Number(s);
  } else {
    return { ok: false, error: `${label} must be an amount in pounds, for example 7.50.` };
  }
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: `${label} must be 0 or more.` };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: `${label} can have at most 2 decimal places.` };
  if (n > MAX_MONEY) return { ok: false, error: `${label} must be at most ${MAX_MONEY}.` };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

function readText(raw: unknown, label: string, max: number, required = false): Parsed<string> {
  if (raw === undefined || raw === null) {
    return required ? { ok: false, error: `${label} is required.` } : { ok: true, value: "" };
  }
  if (typeof raw !== "string") return { ok: false, error: `${label} must be text.` };
  const value = raw.trim();
  if (required && !value) return { ok: false, error: `${label} is required.` };
  if (value.length > max) return { ok: false, error: `${label} must be at most ${max} characters.` };
  return { ok: true, value };
}

/** Matches a member name case-insensitively and returns the canonical spelling from the list. */
export function matchMember(raw: unknown, members: readonly string[]): Parsed<string> {
  if (typeof raw !== "string" || !raw.trim()) return { ok: false, error: "Member is required." };
  const key = raw.trim().toLowerCase();
  const found = members.find((m) => m.toLowerCase() === key);
  return found ? { ok: true, value: found } : { ok: false, error: `Unknown member "${raw.trim()}".` };
}

export function asRecord(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

// ---------- results ----------

export type ResultInput = {
  date: string;
  member: string;
  description: string;
  stake: number;
  returns: number;
  notes: string;
};

/** `members` is the list of names that may be credited (the sheet's members plus "Syndicate"). */
export function parseResultInput(
  body: unknown,
  ctx: { members: readonly string[]; today: string },
): Parsed<ResultInput> {
  const b = asRecord(body);
  if (!b) return { ok: false, error: "Each result must be an object." };
  const date = readDay(b.date, "date", ctx.today);
  if (!date.ok) return date;
  const member = matchMember(b.member, ctx.members);
  if (!member.ok) return member;
  const description = readText(b.description, "description", 200);
  if (!description.ok) return description;
  const stake = parseMoney(b.stake, "stake", { required: false, defaultValue: DEFAULT_RESULT_STAKE });
  if (!stake.ok) return stake;
  const returns = parseMoney(b.returns, "returns", { required: true });
  if (!returns.ok) return returns;
  const notes = readText(b.notes, "notes", 2000);
  if (!notes.ok) return notes;
  return {
    ok: true,
    value: {
      date: date.value,
      member: member.value,
      description: description.value,
      stake: stake.value,
      returns: returns.value,
      notes: notes.value,
    },
  };
}

/** The members a result may be credited to: the sheet's members and the syndicate itself. */
export function resultMembers(sheetMembers: readonly string[]): string[] {
  return [...sheetMembers, SYNDICATE_LABEL];
}

// ---------- fines ----------

export type FineInput = { member: string; amount: number; reason: string; date: string };

export function parseFineInput(body: unknown, ctx: { members: readonly string[]; today: string }): Parsed<FineInput> {
  const b = asRecord(body);
  if (!b) return { ok: false, error: "Request body must be a JSON object." };
  const member = matchMember(b.member, ctx.members);
  if (!member.ok) return member;
  const amount = parseMoney(b.amount, "amount", { required: true });
  if (!amount.ok) return amount;
  const reason = readText(b.reason, "reason", 200);
  if (!reason.ok) return reason;
  const date = readDay(b.date, "date", ctx.today);
  if (!date.ok) return date;
  return { ok: true, value: { member: member.value, amount: amount.value, reason: reason.value, date: date.value } };
}

export function parsePaidFlag(body: unknown): Parsed<boolean> {
  const b = asRecord(body);
  if (!b || typeof b.paid !== "boolean") return { ok: false, error: "paid must be true or false." };
  return { ok: true, value: b.paid };
}

// ---------- payments ----------

export type PaymentInput = { member: string; weekNumber: number; paid: boolean; note: string };

/** `weeks` are the post-cut-off weeks that count so far (see postCutoffWeeks). */
export function parsePaymentInput(
  body: unknown,
  ctx: { members: readonly string[]; weeks: readonly number[] },
): Parsed<PaymentInput> {
  const b = asRecord(body);
  if (!b) return { ok: false, error: "Request body must be a JSON object." };
  const member = matchMember(b.member, ctx.members);
  if (!member.ok) return member;
  const week = typeof b.weekNumber === "number" ? b.weekNumber : Number(b.weekNumber);
  if (!Number.isInteger(week)) return { ok: false, error: "weekNumber must be a whole number." };
  if (!ctx.weeks.includes(week)) {
    if (ctx.weeks.length === 0) return { ok: false, error: "No week after the cut-off is open for payments yet." };
    return {
      ok: false,
      error: `Week ${week} is not open for payments. Weeks ${ctx.weeks[0]} to ${ctx.weeks[ctx.weeks.length - 1]} can be recorded.`,
    };
  }
  if (typeof b.paid !== "boolean") return { ok: false, error: "paid must be true or false." };
  const note = readText(b.note, "note", 500);
  if (!note.ok) return note;
  return { ok: true, value: { member: member.value, weekNumber: week, paid: b.paid, note: note.value } };
}

// ---------- CSV ----------

/** RFC 4180 style: quoted fields, "" inside quotes, CRLF or LF line endings, optional BOM. Blank lines are skipped. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export type CsvRowCheck = {
  /** 1-based number of the data row (the header is not counted). */
  row: number;
  /** The cells as they appear in the file, in column order of the header. */
  cells: Record<string, string>;
  value?: ResultInput;
  error?: string;
};

/**
 * Checks a results CSV. Headers may be in any order and case; extra columns are ignored, but all five of
 * date, member, description, stake and returns must be present. Every data row is checked, so the
 * preview can highlight the rows with errors. A blank stake takes the default (2.50).
 */
export function checkResultsCsv(
  text: string,
  ctx: { members: readonly string[]; today: string },
): { headerError: string | null; rows: CsvRowCheck[] } {
  const table = parseCsv(text);
  if (table.length === 0) return { headerError: "The file is empty.", rows: [] };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const missing = RESULT_CSV_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) {
    return { headerError: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. The header row must be ${RESULT_CSV_COLUMNS.join(",")}.`, rows: [] };
  }
  const data = table.slice(1);
  if (data.length === 0) return { headerError: "No rows under the header.", rows: [] };
  if (data.length > MAX_BULK_ROWS) {
    return { headerError: `At most ${MAX_BULK_ROWS} rows can be uploaded at once (this file has ${data.length}).`, rows: [] };
  }
  const rows = data.map((cells, i): CsvRowCheck => {
    const record: Record<string, string> = {};
    RESULT_CSV_COLUMNS.forEach((col) => {
      const idx = header.indexOf(col);
      record[col] = idx >= 0 && idx < cells.length ? cells[idx].trim() : "";
    });
    const parsed = parseResultInput(
      { date: record.date, member: record.member, description: record.description, stake: record.stake, returns: record.returns },
      ctx,
    );
    return parsed.ok ? { row: i + 1, cells: record, value: parsed.value } : { row: i + 1, cells: record, error: parsed.error };
  });
  return { headerError: null, rows };
}
