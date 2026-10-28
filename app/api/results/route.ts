import { NextResponse } from "next/server";
import { dbErrorResponse, readyDb } from "@/lib/db";
import { MAX_BULK_ROWS, asRecord, parseResultInput, resultMembers, todayDay } from "@/lib/entries";
import { insertResults, listResults } from "@/lib/records";
import { loadTracker } from "@/lib/tracker";

export const dynamic = "force-dynamic";

// GET /api/results: all results, newest first.
export async function GET() {
  try {
    const sql = await readyDb();
    return NextResponse.json({ results: await listResults(sql) });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// POST /api/results: add one result ({ ...fields }) or several ({ rows: [ ...fields ] }), all or nothing.
// Fields: date (YYYY-MM-DD), member, description?, stake (default 2.50), returns (incl. stake; 0 for a loss), notes?.
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Request body must be JSON." }, { status: 400 });
  }
  const tracker = loadTracker();
  if (!tracker) {
    return NextResponse.json({ error: "tracker_unavailable", message: "The spreadsheet data is not loaded." }, { status: 503 });
  }
  const b = asRecord(body);
  if (!b) return NextResponse.json({ error: "validation", message: "Request body must be a JSON object." }, { status: 400 });
  const items: unknown[] = Array.isArray(b.rows) ? b.rows : [b];
  if (items.length === 0) return NextResponse.json({ error: "validation", message: "No rows to add." }, { status: 400 });
  if (items.length > MAX_BULK_ROWS) {
    return NextResponse.json({ error: "validation", message: `At most ${MAX_BULK_ROWS} rows at once.` }, { status: 400 });
  }
  const ctx = { members: resultMembers(tracker.members.map((m) => m.name)), today: todayDay() };
  const values = [];
  for (let i = 0; i < items.length; i++) {
    const parsed = parseResultInput(items[i], ctx);
    if (!parsed.ok) {
      const prefix = items.length > 1 ? `Row ${i + 1}: ` : "";
      return NextResponse.json({ error: "validation", message: `${prefix}${parsed.error}` }, { status: 400 });
    }
    values.push(parsed.value);
  }
  try {
    const sql = await readyDb();
    const inserted = await insertResults(sql, values);
    return NextResponse.json({ inserted }, { status: 201 });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
