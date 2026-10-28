import { NextResponse } from "next/server";
import { dbErrorResponse, insertBet, listBets, parseNewBet, readyDb } from "@/lib/db";

// Always read live data; never prerender or cache this route.
export const dynamic = "force-dynamic";

// GET /api/bets: all bets, newest first.
export async function GET() {
  try {
    const sql = await readyDb();
    return NextResponse.json({ bets: await listBets(sql) });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// POST /api/bets: propose a new bet (status starts as "proposed").
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = parseNewBet(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "validation", message: parsed.error }, { status: 400 });
  }
  try {
    const sql = await readyDb();
    const bet = await insertBet(sql, parsed.value);
    return NextResponse.json({ bet }, { status: 201 });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
