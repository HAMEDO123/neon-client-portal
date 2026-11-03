import { cookies, headers } from "next/headers";
import {
  EMPLOYEE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  verifyAdminSession,
  verifyEmployeeSessionToken,
  type AdminSession,
} from "@/lib/auth";

// Where a session comes from.
//
// A browser carries it in a cookie. The phone app has no cookie jar, so it
// carries the very same signed value in an `Authorization: Bearer` header —
// `/api/mobile/login` issues it with `createSessionToken` /
// `createEmployeeSessionToken`, exactly as the two sign-in actions do for the
// cookies. So "is this the manager" and "which employee is this" have one
// answer each, whichever way the token arrived, and every guard built on
// these two functions works unchanged for the app.
//
// Accepting the header adds no way in that the cookie did not already give:
// a browser never attaches an Authorization header on its own, so there is no
// cross-site request that could carry one, and the token itself is the same
// credential with the same seven-day life. See the note at the top of
// lib/mobile-auth.ts for the same reasoning on the mobile routes.

async function bearerToken(): Promise<string | null> {
  const header = (await headers()).get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * This request's admin session, if it has one: whether it is the manager, and
 * whether it is still inside its hour of editing (see lib/admin-password.ts).
 *
 * The cookie is tried first and the bearer token second, and whichever answers
 * is the one whose unlock window counts. One browser or one phone holds one
 * admin session, so there is nothing to merge.
 */
export async function adminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  return (
    (await verifyAdminSession(store.get(SESSION_COOKIE_NAME)?.value)) ??
    (await verifyAdminSession(await bearerToken()))
  );
}

/**
 * Whether this request is the manager's — by cookie, or by the app's bearer
 * token.
 *
 * Deliberately says nothing about the editing hour: this is "may this person
 * see the manager's side", which a locked session still may. Anything that
 * *changes* something goes through `requireAdmin`, which asks `adminSession`
 * for the rest of the answer.
 */
export async function hasAdminSession(): Promise<boolean> {
  return (await adminSession()) !== null;
}

/**
 * The employee id this request's session names, by cookie or bearer token —
 * a signature check only. Whether that person may still sign in is the
 * caller's to check against the database (see getSessionEmployee).
 */
export async function sessionEmployeeId(): Promise<string | null> {
  const store = await cookies();
  return (
    verifyEmployeeSessionToken(store.get(EMPLOYEE_SESSION_COOKIE_NAME)?.value) ??
    verifyEmployeeSessionToken(await bearerToken())
  );
}
