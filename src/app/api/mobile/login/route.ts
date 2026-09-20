import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createEmployeeSessionToken, createSessionToken } from "@/lib/auth";

// Signing in from a phone app.
//
// An email means somebody on the team; without one it is the manager's own
// shared password, which is how this route has always worked — the existing
// admin app posts `{ password }` and reads `{ token }`, and still does.

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";

  if (!password) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  // --- Somebody on the team -------------------------------------------
  if (email) {
    const employee = await prisma.employee.findUnique({ where: { email } });

    // One message for every failure: a wrong password, an unknown address and a
    // disabled account must be indistinguishable from outside.
    const invalid = NextResponse.json({ error: "Invalid email or password." }, { status: 401 });

    if (!employee?.passwordHash || !employee.active || employee.accessRole !== "EMPLOYEE") {
      // Spend the time anyway, so a missing account is not detectably faster.
      await bcrypt.compare(password, "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
      return invalid;
    }

    if (!(await bcrypt.compare(password, employee.passwordHash))) return invalid;

    await prisma.employee.update({ where: { id: employee.id }, data: { lastLoginAt: new Date() } });

    return NextResponse.json({
      token: createEmployeeSessionToken(employee.id),
      side: "EMPLOYEE",
      id: employee.id,
      name: employee.name,
    });
  }

  // --- The manager ------------------------------------------------------
  const hash = process.env.ADMIN_PASSWORD_HASH;
  if (!hash) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  if (!(await bcrypt.compare(password, hash))) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  return NextResponse.json({ token: createSessionToken(), side: "ADMIN", name: "Manager" });
}
