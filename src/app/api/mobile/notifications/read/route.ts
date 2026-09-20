import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mobileEmployee } from "@/lib/mobile-auth";

// Marking notifications read: one by id, or all of them when no id is given.
//
// Scoped by employeeId in the `where` rather than checked first, so another
// person's notification matches no rows instead of being refused — the same
// shape the portal's own action uses.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const body = await request.json().catch(() => null);
  const id = typeof body?.id === "string" && body.id ? body.id : null;

  const { count } = await prisma.notification.updateMany({
    where: { employeeId: employee.id, readAt: null, ...(id ? { id } : {}) },
    data: { readAt: new Date() },
  });

  return NextResponse.json({ ok: true, marked: count });
}
