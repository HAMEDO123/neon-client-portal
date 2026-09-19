import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { getSessionEmployee } from "@/lib/employee-session";

// One definition of "is this the manager".
//
// A server action is a public POST endpoint. The dashboard layout's redirect
// keeps a browser out of the pages, but it is not a security boundary: anybody
// who knows an action's id can call it directly, with no page involved. So the
// check belongs inside the action, and it belongs in one place — a security
// primitive copied into twenty files is a security primitive that drifts in
// nineteen of them.
//
// This file is deliberately NOT a "use server" module. Every export of one of
// those becomes callable over the network, and a guard that can itself be
// called is not a guard.

export async function requireAdmin(): Promise<void> {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

/** Whoever is acting: the manager, or one of the team. */
export type Staff = { type: "ADMIN" } | { type: "EMPLOYEE"; id: string; name: string };

/**
 * The second guard: the manager **or** somebody on the team, and nobody else.
 *
 * The studio decided that the team works a project the same way the manager
 * does — the same screens, the same edits, and removing a file as well as
 * adding one. This is what lets them, and the shape of it matters:
 *
 * - **`requireAdmin` was not loosened.** It still guards payroll, employees,
 *   settings, the week board, automation and deleting a project. Widening it
 *   would not have meant "employees too", it would have meant everything.
 * - **It is here, beside the other one, rather than copied into eleven action
 *   files.** Eleven copies of a security primitive is the arrangement that put
 *   twenty-five copies of `requireAdmin` in this codebase before they were
 *   collapsed into one: they do not drift because somebody is careless, they
 *   drift because there are eleven chances for one to be edited and the rest
 *   not.
 * - **It returns who is acting.** Nothing needs that yet, but "an employee did
 *   this" is the fact any later rule — telling the manager, or writing down who
 *   removed a file — would have to start from, and a guard that threw it away
 *   would have to be changed everywhere to get it back.
 *
 * An employee session is re-read from the database on every call, so somebody
 * disabled in the admin loses these on their next request, exactly as they lose
 * the rest of the portal.
 */
export async function requireStaff(): Promise<Staff> {
  const store = await cookies();
  if (verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) return { type: "ADMIN" };

  const employee = await getSessionEmployee();
  if (employee) return { type: "EMPLOYEE", id: employee.id, name: employee.name };

  throw new Error("Unauthorized");
}
