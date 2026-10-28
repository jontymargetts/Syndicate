import { NextResponse } from "next/server";
import { dbErrorResponse, readyDb } from "@/lib/db";
import { parsePaidFlag } from "@/lib/entries";
import { deleteFine, setFinePaid } from "@/lib/records";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// PATCH /api/fines/:id: body { paid: true | false }. Marking paid records paid_at; marking unpaid clears it.
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found", message: "Fine not found." }, { status: 404 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = parsePaidFlag(body);
  if (!parsed.ok) return NextResponse.json({ error: "validation", message: parsed.error }, { status: 400 });
  try {
    const sql = await readyDb();
    const fine = await setFinePaid(sql, id, parsed.value);
    if (!fine) return NextResponse.json({ error: "not_found", message: "Fine not found." }, { status: 404 });
    return NextResponse.json({ fine });
  } catch (err) {
    return dbErrorResponse(err);
  }
}

// DELETE /api/fines/:id
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found", message: "Fine not found." }, { status: 404 });
  try {
    const sql = await readyDb();
    if (!(await deleteFine(sql, id))) {
      return NextResponse.json({ error: "not_found", message: "Fine not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
