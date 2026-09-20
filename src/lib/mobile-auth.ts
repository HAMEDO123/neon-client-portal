import { prisma } from "@/lib/db";
import { verifyEmployeeSessionToken, verifySessionToken } from "@/lib/auth";
import type { Staff } from "@/lib/admin-guard";
import type { ChatViewer } from "@/lib/chat-conversations";

/** The Bearer token on a request, or null when there isn't one. */
export function bearerToken(request: Request): string | null {
  const auth = request.headers.get("authorization") ?? "";
  return auth.startsWith("Bearer ") ? auth.slice(7) : null;
}

// Same signed token as the web session cookie, just carried as a Bearer
// header instead — the native app has no cookie jar of its own.
export function requireMobileAuth(request: Request): boolean {
  return verifySessionToken(bearerToken(request));
}

/**
 * Who is calling the mobile API: the manager, somebody on the team, or nobody.
 *
 * This is `requireStaff` from `lib/admin-guard.ts` read off a header instead of
 * a cookie, and it returns the same `Staff`, deliberately — the app and the web
 * portal have to mean the same thing by "an employee did this", or the two
 * drift and the mobile one is the copy nobody is looking at.
 *
 * Three things about the shape:
 *
 * - **`requireMobileAuth` was not loosened.** It still answers "is this the
 *   manager" and still guards every route that was admin-only before. Widening
 *   it would not have meant "employees too", it would have meant that every
 *   existing mobile route silently started accepting employees — including the
 *   ones that create and edit projects.
 * - **The manager keeps using the admin token.** They have an `Employee` row
 *   (`accessRole: "MANAGER"`, the one the attendance device is paired to), but
 *   signing them in as that row would give them an employee session, which the
 *   employee portal's own guard refuses anyway. On the web the manager is a
 *   session rather than a person; the app does not get to disagree. When a
 *   device token needs an employee id to hang off, `managerEmployeeId()` is
 *   how the web resolves it and how the app will too.
 * - **The employee row is re-read on every call**, exactly as
 *   `getSessionEmployee` does it, so somebody disabled in the admin loses the
 *   app on their next request and not whenever a seven-day token expires. A
 *   signed token only proves we issued it; it says nothing about whether the
 *   account still exists, is still enabled, or is still on the team.
 */
export async function mobileStaff(request: Request): Promise<Staff | null> {
  const token = bearerToken(request);
  if (!token) return null;

  if (verifySessionToken(token)) return { type: "ADMIN" };

  const employeeId = verifyEmployeeSessionToken(token);
  if (!employeeId) return null;

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, active: true, accessRole: "EMPLOYEE" },
    select: { id: true, name: true },
  });
  if (!employee) return null;

  return { type: "EMPLOYEE", id: employee.id, name: employee.name };
}

/**
 * The same caller, as chat knows them.
 *
 * `ChatViewer` and `Staff` are the same fact in two vocabularies — chat was
 * written before there was a second guard — and the conversion belongs here,
 * once, rather than in each route that needs it. The manager is "Manager" with
 * a null id on both sides: in chat they are a session rather than a person,
 * which is what `readerKeyFor` turns into the member key "admin".
 */
export async function mobileChatViewer(request: Request): Promise<ChatViewer | null> {
  const staff = await mobileStaff(request);
  if (!staff) return null;

  return staff.type === "ADMIN"
    ? { type: "ADMIN", id: null, name: "Manager" }
    : { type: "EMPLOYEE", id: staff.id, name: staff.name };
}
