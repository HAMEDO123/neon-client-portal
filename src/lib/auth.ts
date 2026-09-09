import crypto from "crypto";
import { EMPLOYEE_SESSION_COOKIE_NAME, SESSION_COOKIE_NAME } from "@/lib/session-cookie";

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return secret;
}

function sign(value: string) {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

export function createSessionToken() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = `admin.${expiresAt}`;
  const signature = sign(payload);
  return `${expiresAt}.${signature}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const [expiresAtRaw, signature] = token.split(".");
  if (!expiresAtRaw || !signature) return false;
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return false;
  const expected = sign(`admin.${expiresAt}`);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
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
