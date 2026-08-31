import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionToken } from "@/lib/auth";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  const hash = process.env.ADMIN_PASSWORD_HASH;

  if (!hash || !password) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  return NextResponse.json({ token: createSessionToken() });
}
