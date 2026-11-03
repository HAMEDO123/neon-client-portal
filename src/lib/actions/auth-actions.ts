"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkAdminPassword } from "@/lib/admin-password";
import { createAdminSessionToken, SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth";

export async function login(_prevState: { error?: string } | undefined, formData: FormData) {
  const password = String(formData.get("password") ?? "");

  // The password now comes from the database, with the environment variable
  // behind it (lib/admin-password.ts) — so the manager can change it from the
  // settings page instead of from a terminal on the PC it runs on.
  if (!(await checkAdminPassword(password))) {
    return { error: "Invalid password." };
  }

  const cookieStore = await cookies();
  // Signing in is itself the password being said, so the session arrives able
  // to edit. The hour starts here.
  cookieStore.set(SESSION_COOKIE_NAME, await createAdminSessionToken(), {
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
