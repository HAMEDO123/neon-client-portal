import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { mobileEmployee } from "@/lib/mobile-auth";

// This person's notifications, newest first.
//
// The same rows the portal shows. Scoped by employeeId, so there is no id an
// app could send that would reach somebody else's.

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const employee = await mobileEmployee(request);
  if (!employee) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const asked = Number(new URL(request.url).searchParams.get("take") ?? 50);
  const take = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), 100) : 50;

  const [notifications, unread] = await Promise.all([
    prisma.notification.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take,
      select: {
        id: true,
        type: true,
        title: true,
        message: true,
        url: true,
        entryId: true,
        readAt: true,
        createdAt: true,
      },
    }),
    prisma.notification.count({ where: { employeeId: employee.id, readAt: null } }),
  ]);

  return NextResponse.json({ unread, notifications });
}
