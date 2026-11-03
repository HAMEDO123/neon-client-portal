import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createAdminSessionToken, createEmployeeSessionToken } from "@/lib/auth";
import { checkAdminPassword, UNLOCK_MINUTES } from "@/lib/admin-password";

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
  // The database's password, with the environment variable behind it
  // (lib/admin-password.ts) — the same one the website checks, so changing it
  // changes it for the app at the same moment.
  if (!(await checkAdminPassword(password))) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  // The token arrives able to edit for an hour, and is still a session for a
  // week after that. Once the hour is up the app can read everything and
  // change nothing until the manager signs in again — which is the studio's
  // rule, not a quirk of the phone.
  return NextResponse.json({
    token: await createAdminSessionToken(),
    side: "ADMIN",
    name: "Manager",
    editableForMinutes: UNLOCK_MINUTES,
  });
}
