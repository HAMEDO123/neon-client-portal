import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createEmployeeSessionToken, createSessionToken } from "@/lib/auth";
import { verifyEmployeeCredentials } from "@/lib/employee-credentials";

// One sign-in for the staff app, two kinds of credential behind it.
//
// **No email means the manager**, with the studio's shared password. That is
// what every build before the staff app sent, and the path is left exactly as
// it was — a phone still running the old app keeps signing in through this
// change, and the reply only gains a field, which its decoder ignores.
//
// **An email means somebody on the team**, checked against their own account
// through the same `verifyEmployeeCredentials` the web sign-in uses. The token
// handed back is an employee session token, carrying their id in the signed
// payload, so nothing downstream has to be told who is calling: `mobileStaff`
// reads it off the header exactly as `requireStaff` reads it off a cookie.
//
// The two token kinds can never be confused for one another — they carry
// different prefixes inside the signature (`lib/auth.ts`), so an employee's
// token cannot verify as the manager's however it is presented.

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const email = typeof body?.email === "string" ? body.email : "";

  if (email) {
    const employee = await verifyEmployeeCredentials(email, password);
    if (!employee) {
      return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
    }

    return NextResponse.json({
      token: createEmployeeSessionToken(employee.id),
      actor: { type: "EMPLOYEE", id: employee.id, name: employee.name },
    });
  }

  const hash = process.env.ADMIN_PASSWORD_HASH;

  if (!hash || !password) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  return NextResponse.json({ token: createSessionToken(), actor: { type: "ADMIN" } });
}
