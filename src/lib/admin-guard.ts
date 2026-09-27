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

/**
 * The manager, or somebody the manager has trusted with the company WhatsApp.
 *
 * A third guard rather than a widening of `requireStaff`, because the company's
 * WhatsApp is not the project board: it carries client prices, complaints and
 * supplier terms, and everyone on the team can already reach the board. Being
 * on the team therefore says nothing about whether you should have it — this is
 * granted one person at a time, in the admin, and defaults to nobody.
 *
 * **Reading and replying are one permission**, decided by the studio: whoever
 * may read the studio's conversations may answer in them, from the same screen,
 * as the studio's number. The column is still called `canReadWhatsApp` because
 * renaming it is a migration for a word; what it grants is this.
 *
 * Read fresh from the database on every call, like `requireStaff`, so taking
 * the permission away takes effect on that person's next request rather than
 * whenever their session happens to expire.
 */
export async function requireWhatsAppAccess(): Promise<Staff> {
  const store = await cookies();
  if (verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) return { type: "ADMIN" };

  const employee = await getSessionEmployee();
  if (employee?.canReadWhatsApp) return { type: "EMPLOYEE", id: employee.id, name: employee.name };

  throw new Error("Unauthorized");
}

/**
 * The manager, or somebody the manager has trusted to hand work out.
 *
 * A fourth guard, and narrow on purpose. `requireStaff` is "anybody on the
 * team", which is right for the contents of a project and wrong for this: the
 * week board decides what other people spend their day on, and a board cell's
 * state is what payroll's progress figures are counted from. So this is one
 * person at a time, ticked on their own page, exactly like the WhatsApp one.
 *
 * What it deliberately does NOT carry, all of it still `requireAdmin`:
 * creating or deleting a project, editing the shared delivery process (a step
 * added here appears on every project the studio runs), resetting a project's
 * board, payroll, employees, settings — and approving finished work, which
 * stays the manager's word.
 *
 * Read fresh from the database on every call, like the others, so taking the
 * permission away takes effect on that person's next request.
 */
export async function requireTaskAssigner(): Promise<Staff> {
  const store = await cookies();
  if (verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) return { type: "ADMIN" };

  const employee = await getSessionEmployee();
  if (employee?.canAssignTasks) return { type: "EMPLOYEE", id: employee.id, name: employee.name };

  throw new Error("Unauthorized");
}

/**
 * The manager, or somebody the manager has asked to keep the site-visit diary.
 *
 * The fifth guard, and the same shape as the two before it: one ticked person
 * at a time, read fresh on every call. It is not `requireStaff` for the
 * ordinary reason — a visit is the studio going to a client's building, and
 * what gets written about one is read by the manager as an account of the
 * business, not as somebody's own notes.
 *
 * It says who is acting, which the actions need: a visitor may only answer for
 * their own visits, and the manager reads all of them and answers for none.
 */
export async function requireSiteVisitor(): Promise<Staff> {
  const store = await cookies();
  if (verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) return { type: "ADMIN" };

  const employee = await getSessionEmployee();
  if (employee?.canLogSiteVisits) return { type: "EMPLOYEE", id: employee.id, name: employee.name };

  throw new Error("Unauthorized");
}
