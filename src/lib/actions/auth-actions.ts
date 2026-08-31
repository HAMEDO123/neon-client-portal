"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const hash = process.env.ADMIN_PASSWORD_HASH;

  if (!hash || !password) {
    return { error: "Invalid password." };
  }

  const valid = await bcrypt.compare(password, hash);
  if (!valid) {
    return { error: "Invalid password." };
  }

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, createSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });

  redirect("/admin");
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
  redirect("/admin/login");
}
