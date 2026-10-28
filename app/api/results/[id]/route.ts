import { NextResponse } from "next/server";
import { dbErrorResponse, readyDb } from "@/lib/db";
import { deleteResult } from "@/lib/records";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// DELETE /api/results/:id
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "not_found", message: "Result not found." }, { status: 404 });
  try {
    const sql = await readyDb();
    if (!(await deleteResult(sql, id))) {
      return NextResponse.json({ error: "not_found", message: "Result not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err);
  }
}
