import crypto from "crypto";
import { adminSessionEpoch, UNLOCK_MINUTES } from "@/lib/admin-password";
import { EMPLOYEE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const UNLOCK_TTL_MS = 1000 * 60 * UNLOCK_MINUTES;

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

function sameSignature(given: string, expected: string) {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// --- The manager's session -------------------------------------------------
//
// An admin token carries three facts, not one: when the session itself runs
// out (a week), when the right to *edit* runs out (an hour — see
// lib/admin-password.ts), and which password it was issued under.
//
// All three are inside the signed payload, so none of them can be moved by
// whoever holds the token. The unlock window is part of the credential rather
// than a second cookie beside it for exactly that reason: a cookie that says
// "unlocked until" and a cookie that says who you are can be mixed and matched
// by hand, and a pair of them is two things to keep in step. Re-unlocking
// re-issues this one value.
//
// The epoch is what makes changing the password end other people's sessions:
// it is a fingerprint of the hash in force, so every token signed under the old
// password stops verifying the moment a new one is saved.

export type AdminSession = {
  /** When the right to edit runs out, as a timestamp. */
  unlockedUntil: number;
  /** Whether that moment is still ahead of us. */
  unlocked: boolean;
};

/** A fresh admin session, unlocked for the next hour. */
export async function createAdminSessionToken(): Promise<string> {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const unlockedUntil = Date.now() + UNLOCK_TTL_MS;
  const epoch = await adminSessionEpoch();
  const signature = sign(`admin.${expiresAt}.${unlockedUntil}.${epoch}`);
  return `${expiresAt}.${unlockedUntil}.${epoch}.${signature}`;
}

/**
 * The same session, with its editing window closed as of now.
 *
 * Signing out is not what this is for — it is "I am done editing", so the next
 * edit asks again. The session itself is untouched.
 */
export async function lockedAdminSessionToken(token: string | undefined | null): Promise<string | null> {
  const parts = (token ?? "").split(".");
  if (parts.length !== 4) return null;
  const expiresAt = Number(parts[0]);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  if (!(await verifyAdminSession(token))) return null;

  const epoch = await adminSessionEpoch();
  const unlockedUntil = Date.now() - 1;
  const signature = sign(`admin.${expiresAt}.${unlockedUntil}.${epoch}`);
  return `${expiresAt}.${unlockedUntil}.${epoch}.${signature}`;
}

/**
 * Whether this is a live admin session, and how long it may still edit for.
 *
 * Null means "not the manager" — an expired session, a forged one, or one
 * issued under a password that has since been changed. A session that is real
 * but past its editing hour comes back with `unlocked: false`: it may still
 * read, which is what keeps a locked platform usable while it waits to be
 * asked for the password again.
 */
export async function verifyAdminSession(token: string | undefined | null): Promise<AdminSession | null> {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [expiresAtRaw, unlockedUntilRaw, epoch, signature] = parts;
  if (!expiresAtRaw || !unlockedUntilRaw || !epoch || !signature) return null;

  const expiresAt = Number(expiresAtRaw);
  const unlockedUntil = Number(unlockedUntilRaw);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(unlockedUntil)) return null;
  if (Date.now() > expiresAt) return null;

  // The epoch is checked by the signature, not by comparing it: a token signed
  // over a stale epoch cannot be re-signed without the secret, so the only way
  // this verifies is if the password has not moved since it was issued.
  if (epoch !== (await adminSessionEpoch())) return null;
  if (!sameSignature(signature, sign(`admin.${expiresAt}.${unlockedUntil}.${epoch}`))) return null;

  return { unlockedUntil, unlocked: Date.now() < unlockedUntil };
}

export { SESSION_COOKIE_NAME };
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000;

// --- Employee sessions -----------------------------------------------------
// Same signing scheme as the admin session above, with the employee id inside
// the signed payload and a distinct prefix. The prefix is what stops an admin
// token from ever verifying as an employee token, or the reverse: the two
// payloads can never collide even though they share a secret.

export function createEmployeeSessionToken(employeeId: string) {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `employee.${employeeId}.${expiresAt}`;
  return `${employeeId}.${expiresAt}.${sign(payload)}`;
}

// Returns the employee id the token was issued for, or null. Callers must
// still check that the employee exists and is active — this only proves the
// token was issued by us and has not expired.
export function verifyEmployeeSessionToken(token: string | undefined | null): string | null {
  if (!token) return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [employeeId, expiresAtRaw, signature] = parts;
  if (!employeeId || !expiresAtRaw || !signature) return null;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  const expected = sign(`employee.${employeeId}.${expiresAt}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  return crypto.timingSafeEqual(a, b) ? employeeId : null;
}

export { EMPLOYEE_SESSION_COOKIE_NAME };
