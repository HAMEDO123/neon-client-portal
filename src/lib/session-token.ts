import { cookies, headers } from "next/headers";
import {
  EMPLOYEE_SESSION_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  verifyEmployeeSessionToken,
  verifySessionToken,
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

/** Whether this request is the manager's — by cookie, or by the app's bearer token. */
export async function hasAdminSession(): Promise<boolean> {
  const store = await cookies();
  if (verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) return true;
  return verifySessionToken(await bearerToken());
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
