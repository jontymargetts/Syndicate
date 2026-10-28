import { NextResponse } from "next/server";
import { dbErrorResponse, readyDb } from "@/lib/db";
import { parseFineInput, todayDay } from "@/lib/entries";
import { insertFine, listFines } from "@/lib/records";
import { loadTracker } from "@/lib/tracker";

export const dynamic = "force-dynamic";

// GET /api/fines: all fines, newest first.
export async function GET() {
  try {
    const sql = await readyDb();
    return NextResponse.json({ fines: await listFines(sql) });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// POST /api/fines: add a fine. Body: { member, amount, reason, date }.
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
  const parsed = parseFineInput(body, {
    members: tracker.members.map((m) => m.name),
    today: todayDay(),
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: "validation", message: parsed.error }, { status: 400 });
  }
  try {
    const sql = await readyDb();
    const fine = await insertFine(sql, parsed.value);
    return NextResponse.json({ fine }, { status: 201 });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
