import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getSetting, setSetting } from "@/lib/settings";

// The manager's own password, and the fingerprint every admin session is
// stamped with.
//
// **It lives in the database now, with the environment variable as a
// fallback.** It began as `ADMIN_PASSWORD_HASH` alone, which meant changing it
// was a terminal session on the machine the platform happens to run on — and
// that machine is a desk in the studio. The studio asked for a password it can
// change from the browser, and for the platform to ask for it again every hour
// before it will accept an edit, because the person at that desk is not always
// the person the session belongs to.
//
// The environment variable is kept as the fallback on purpose. Nothing here can
// lock the manager out: an empty settings table, a restored backup, a database
// swapped underneath the app — any of them and the platform falls back to the
// password it shipped with rather than to no way in at all. It is not a
// weakening, either: anybody who can delete the row could have written their
// own hash into it instead.

export const ADMIN_PASSWORD_KEY = "admin_password_hash";

/** The shortest password the studio will accept for its own admin. */
export const MIN_ADMIN_PASSWORD = 8;

/** How long one unlock lasts before the platform asks again. */
export const UNLOCK_MINUTES = 60;

// The hash is read on the way in to every admin request — a session cannot be
// verified without it (see `adminSessionEpoch`) — so it is held for a few
// seconds rather than fetched each time. The window is short and the write
// clears it, so changing the password still ends other sessions at once in this
// process; another process would notice within the window.
const MEMO_MS = 5_000;
let memo: { hash: string | null; at: number } | null = null;

/** The hash the admin password is checked against, or null if there is none. */
export async function activeAdminHash(): Promise<string | null> {
  if (memo && Date.now() - memo.at < MEMO_MS) return memo.hash;

  const saved = await getSetting(ADMIN_PASSWORD_KEY);
  const fromEnv = process.env.ADMIN_PASSWORD_HASH;
  const hash =
    saved && saved.startsWith("$2") ? saved : fromEnv && fromEnv.startsWith("$2") ? fromEnv : null;

  memo = { hash, at: Date.now() };
  return hash;
}

/**
 * Drops the held hash, so the next read goes to the database.
 *
 * Called by `saveAdminPassword` — the whole value of the lock is that a new
 * password takes other sessions down *now*, not within five seconds — and by
 * the tests, which change the password underneath it on purpose.
 */
export function forgetActiveAdminHash() {
  memo = null;
}

/** Whether the password has been changed from the one the platform shipped with. */
export async function adminPasswordIsOwn(): Promise<boolean> {
  const saved = await getSetting(ADMIN_PASSWORD_KEY);
  return !!saved && saved.startsWith("$2");
}

/**
 * Whether this is the admin password.
 *
 * With no hash configured at all the answer is always no. Refusing everybody is
 * the only safe reading of "there is no password": the alternative is a
 * platform that opens for anybody the moment its configuration goes missing.
 */
export async function checkAdminPassword(password: string): Promise<boolean> {
  const hash = await activeAdminHash();
  if (!password || !hash) {
    // Spend the time anyway, so "no password is set" is not detectably faster
    // than a wrong one.
    await bcrypt.compare(password || "x", "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
    return false;
  }
  return bcrypt.compare(password, hash);
}

/** Replace the admin password. The caller has already proved it may. */
export async function saveAdminPassword(password: string): Promise<void> {
  await setSetting(ADMIN_PASSWORD_KEY, await bcrypt.hash(password, 10));
  forgetActiveAdminHash();
}

/**
 * The short fingerprint of the password in force, carried inside every admin
 * session token.
 *
 * This is what makes changing the password end the sessions opened under the
 * old one. A session is signed over its epoch, so once the hash changes, every
 * token issued before it stops verifying — on the web and in the phone app, at
 * the same instant, without a list of sessions to walk or a restart. Which is
 * the whole point of being able to change it: somebody is signed in on a
 * machine that is not yours, and the one thing you want is for them not to be.
 */
export async function adminSessionEpoch(): Promise<string> {
  const hash = (await activeAdminHash()) ?? "";
  return crypto.createHash("sha256").update(`admin-epoch.${hash}`).digest("hex").slice(0, 12);
}

/** What is wrong with a proposed password, or null if nothing is. */
export function passwordComplaint(next: string, confirm: string): string | null {
  if (next.length < MIN_ADMIN_PASSWORD) {
    return `The new password must be at least ${MIN_ADMIN_PASSWORD} characters.`;
  }
  if (next !== confirm) return "The two new passwords do not match.";
  return null;
}
