import { NextResponse } from "next/server";
import { dbErrorResponse, parseBetPatch, readyDb, updateBet } from "@/lib/db";
import { deleteBet } from "@/lib/records";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/bets/:id: advance status and record placed/settled details. When settling, returns are
// computed here unless supplied (see updateBet in lib/db.ts).
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "not_found", message: "Bet not found." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = parseBetPatch(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: "validation", message: parsed.error }, { status: 400 });
  }

  try {
    const sql = await readyDb();
    const result = await updateBet(sql, id, parsed.value);
    switch (result.kind) {
      case "ok":
        return NextResponse.json({ bet: result.bet });
      case "not_found":
        return NextResponse.json({ error: "not_found", message: "Bet not found." }, { status: 404 });
      case "invalid":
        return NextResponse.json({ error: "invalid_transition", message: result.error }, { status: 409 });
      case "invalid_input":
        return NextResponse.json({ error: "validation", message: result.error }, { status: 400 });
      case "conflict":
        return NextResponse.json({ error: "conflict", message: "The bet changed while you were editing. Refresh and try again." }, { status: 409 });
    }
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// DELETE /api/bets/:id: removes the bet. A deleted bet drops out of every figure.
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) {
    return NextResponse.json({ error: "not_found", message: "Bet not found." }, { status: 404 });
  }
  try {
    const sql = await readyDb();
    if (!(await deleteBet(sql, id))) {
      return NextResponse.json({ error: "not_found", message: "Bet not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
