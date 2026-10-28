import { NextResponse } from "next/server";
import { dbErrorResponse, readyDb } from "@/lib/db";
import { parsePaymentInput } from "@/lib/entries";
import { upsertPayment, listPayments } from "@/lib/records";
import { loadTracker } from "@/lib/tracker";
import { postCutoffWeeks } from "@/lib/stats";

// Always read live data; never prerender or cache this route.
export const dynamic = "force-dynamic";

// GET /api/payments: stored exceptions only. A member-week with no row is paid.
export async function GET() {
  try {
    const sql = await readyDb();
    return NextResponse.json({ payments: await listPayments(sql) });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// POST /api/payments: set one member-week to paid or missed. Only weeks after the cut-off, up to the current week.
// Body: { member, weekNumber, paid, note? }. Re-ticking a week stores paid = true (it no longer counts as missed).
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
  const parsed = parsePaymentInput(body, {
    members: tracker.members.map((m) => m.name),
    weeks: postCutoffWeeks(tracker, new Date()),
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: "validation", message: parsed.error }, { status: 400 });
  }
  try {
    const sql = await readyDb();
    await upsertPayment(sql, parsed.value);
    return NextResponse.json({ payment: parsed.value });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
