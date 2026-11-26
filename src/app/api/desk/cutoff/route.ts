import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { applyManualCutoff, takeBackCutoff } from "@/lib/manual-cutoff";
import { Refusal } from "@/lib/refusal";

// The WhatsApp desk's assistant («شادي», whatsapp-desk/server.js) taking pay off
// on the manager's word in the team group (asked for on 2026-11-26: "بس احكي لك
// اخصم على وائل … وتخصم"). The desk checks that the words came from the
// manager's own number; this route trusts the desk and nobody else.
//
// GET  → the team, so a name said in Arabic can be matched to a person.
// POST { action: "add", employeeId, hours | amount, reason } → the cutoff, priced
//      and announced exactly as the payroll screen's (lib/manual-cutoff.ts).
// POST { action: "remove", id } → takes one back.
//
// Shut unless DESK_SECRET is set, like the cron endpoint without CRON_SECRET.

export const dynamic = "force-dynamic";

function authorised(request: Request) {
  const secret = process.env.DESK_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const wanted = Buffer.from(secret);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function GET(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const team = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    select: { id: true, name: true, phone: true },
    orderBy: { name: "asc" },
  });
  return NextResponse.json({ team });
}

export async function POST(request: Request) {
  if (!authorised(request)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Send JSON." }, { status: 400 });
  }
  try {
    if (body.action === "remove") {
      const row = await takeBackCutoff(String(body.id ?? ""));
      return NextResponse.json({ ok: true, id: row.id, amount: row.amount });
    }
    if (body.action !== "add") return NextResponse.json({ error: "Say add or remove." }, { status: 400 });
    const row = await applyManualCutoff({
      employeeId: String(body.employeeId ?? ""),
      hours: body.hours,
      amount: body.amount,
      reason: String(body.reason ?? ""),
    });
    const employee = await prisma.employee.findUnique({ where: { id: row.employeeId }, select: { name: true } });
    return NextResponse.json({ ok: true, id: row.id, name: employee?.name ?? "", hours: row.hours, amount: row.amount });
  } catch (error) {
    if (error instanceof Refusal) return NextResponse.json({ error: error.message }, { status: 422 });
    console.error("[desk-cutoff]", error);
    return NextResponse.json({ error: "Could not save it." }, { status: 500 });
  }
}
