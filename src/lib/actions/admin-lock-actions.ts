"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { checkAdminPassword, passwordComplaint, saveAdminPassword } from "@/lib/admin-password";
import {
  createAdminSessionToken,
  lockedAdminSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from "@/lib/auth";
import { adminSession } from "@/lib/session-token";

// Saying the password again, and changing it.
//
// The studio asked for both on 2026-11-03, for one reason: the platform runs on
// a PC in the studio that is not only the manager's, and until now a browser
// left signed in on it was the whole of the credential. So an edit is allowed
// for an hour after the password is said (lib/admin-guard.ts), and the password
// itself can be changed from the settings page rather than from a terminal on
// that PC (lib/admin-password.ts).
//
// None of these call `requireAdmin`, and that is deliberate: `requireAdmin` is
// the thing being unlocked, so requiring it here would mean needing the hour in
// order to ask for the hour. They require a *session* and the password instead,
// which is the stronger of the two checks anyway.

/** Keeps the session cookie's own settings in one place. */
async function writeSessionCookie(token: string) {
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export type LockResult = { error?: string; ok?: boolean };

/**
 * Another hour of editing, in exchange for the password.
 *
 * Re-issues the session rather than setting a second cookie beside it: the
 * unlock lives inside the signed token (lib/auth.ts), so there is one value to
 * hold and nothing that can be unlocked by editing a cookie by hand.
 */
export async function unlockEditing(
  _prevState: LockResult | undefined,
  formData: FormData
): Promise<LockResult> {
  if (!(await adminSession())) return { error: "Sign in again." };

  const password = String(formData.get("password") ?? "");
  if (!(await checkAdminPassword(password))) {
    return { error: "Wrong password." };
  }

  await writeSessionCookie(await createAdminSessionToken());
  return { ok: true };
}

/**
 * Closes the hour now, without signing out.
 *
 * What the manager presses on getting up from a desk that is not theirs. The
 * session survives, so the screens stay readable; the next edit asks.
 */
export async function lockEditingNow(): Promise<LockResult> {
  const cookieStore = await cookies();
  const locked = await lockedAdminSessionToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!locked) return { error: "Sign in again." };

  await writeSessionCookie(locked);
  revalidatePath("/admin", "layout");
  return { ok: true };
}

/**
 * A new admin password.
 *
 * The current one is required even though the browser is already signed in,
 * because "signed in" is exactly the thing in doubt: a session someone else
 * left open must not be able to lock the manager out of their own platform.
 *
 * Saving it ends every other admin session on the spot — on the web and in the
 * phone app — because the session token is signed over a fingerprint of the
 * password (lib/admin-password.ts). That is the point of the feature rather
 * than a side effect, so this browser's own session is re-issued immediately
 * afterwards; without that the manager would change the password and lock
 * themselves out along with everybody else.
 */
export async function changeAdminPassword(
  _prevState: LockResult | undefined,
  formData: FormData
): Promise<LockResult> {
  if (!(await adminSession())) return { error: "Sign in again." };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!(await checkAdminPassword(current))) {
    return { error: "That is not the current password." };
  }

  const complaint = passwordComplaint(next, confirm);
  if (complaint) return { error: complaint };

  if (await checkAdminPassword(next)) {
    return { error: "That is already the password." };
  }

  await saveAdminPassword(next);
  // Order matters: the new token is signed over the new password's fingerprint,
  // so it has to be made after the save, not before.
  await writeSessionCookie(await createAdminSessionToken());

  revalidatePath("/admin/settings");
  return { ok: true };
}
