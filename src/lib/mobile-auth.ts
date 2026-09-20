import { verifyEmployeeSessionToken, verifySessionToken } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { ChatViewer } from "@/lib/chat-conversations";

// Who a native app is, from the token it carries.
//
// The phone has no cookie jar, so the same signed tokens the web uses travel in
// an Authorization header instead. There are two of them, and which one arrived
// is what says whether this is the manager or somebody on the team.
//
// **These routes deliberately do not check the request's origin**, where the
// browser-facing ones do. A cookie is attached by the browser to any request to
// this site, whoever caused it, which is what makes a same-origin check
// necessary there; a bearer token is attached by nothing but the app that holds
// it, so there is no cross-site request to forge.

/** The bearer token on a request, or nothing. */
function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

/**
 * The manager, and only the manager. Kept as it was for the existing admin app
 * and the routes it already calls.
 */
export function requireMobileAuth(request: Request): boolean {
  return verifySessionToken(bearer(request));
}

/**
 * Whoever is signed in on the phone — the manager or one of the team — in the
 * same shape the chat itself speaks.
 *
 * An employee's row is re-read on every request, exactly as the web session
 * does: somebody disabled in the admin loses the app on their next tap rather
 * than at the end of the week their token would otherwise have run for.
 */
export async function mobileViewer(request: Request): Promise<ChatViewer | null> {
  const token = bearer(request);
  if (!token) return null;

  if (verifySessionToken(token)) return { type: "ADMIN", id: null, name: "Manager" };

  const employeeId = verifyEmployeeSessionToken(token);
  if (!employeeId) return null;

  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, active: true, accessRole: "EMPLOYEE" },
    select: { id: true, name: true },
  });

  return employee ? { type: "EMPLOYEE", id: employee.id, name: employee.name } : null;
}

/**
 * The signed-in employee, for the parts of the app that are theirs alone —
 * their day, their tasks, their notifications.
 *
 * The manager gets null here rather than somebody else's work: there is no
 * "acting as" in this platform, and the admin's own screens are a different
 * set of routes.
 */
export async function mobileEmployee(request: Request): Promise<{ id: string; name: string } | null> {
  const viewer = await mobileViewer(request);
  return viewer?.type === "EMPLOYEE" ? { id: viewer.id, name: viewer.name } : null;
}
