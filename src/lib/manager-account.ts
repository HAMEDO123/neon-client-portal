import { prisma } from "@/lib/db";

// The manager, as something a notification can be addressed to.
//
// Everywhere else in the platform the manager is a session, not a person: they
// have no employee row, they are the member key "admin" in calls and chat, and
// `dispatchNotification` — which takes an employee id — simply had no way to
// reach them. So the chat path returned no recipients for them and the call
// path filtered them out by name.
//
// They do have a row now, carrying `accessRole: "MANAGER"`, created so the
// fingerprint device had something to pair to. It is deliberately excluded from
// every query that means "the team"; this is the one place that looks it up on
// purpose, so a notification can be delivered to the person rather than to a
// role that owns nothing.
//
// Not "use server": every export of one of those is callable over the network.

export const MANAGER_ACCESS_ROLE = "MANAGER";

/** The member key the manager is known by in calls, chat reads and presence. */
export const MANAGER_MEMBER_KEY = "admin";

/**
 * The manager's employee id, or null when this installation has no such row.
 *
 * Null is an ordinary answer, not a fault: the row exists only because somebody
 * paired the manager to the attendance device, and a studio that has not done
 * that still runs. Callers skip the notification rather than failing — nobody
 * should lose a message because the manager has no phone registered.
 */
export async function managerEmployeeId(): Promise<string | null> {
  const row = await prisma.employee.findFirst({
    where: { accessRole: MANAGER_ACCESS_ROLE, active: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  return row?.id ?? null;
}

/**
 * Turns a call or chat member key into an employee id to notify.
 *
 * "admin" resolves to the manager's row; anything else is already an employee
 * id. Returns null when there is nobody to tell, which is what both callers
 * want — a call must still ring everybody else if the manager cannot be
 * reached.
 */
export async function notifiableEmployeeId(memberKey: string): Promise<string | null> {
  if (memberKey !== MANAGER_MEMBER_KEY) return memberKey;
  return managerEmployeeId();
}
