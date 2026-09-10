import { prisma } from "@/lib/db";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH } from "@/lib/notifications/types";
import { MAX_REASON_LENGTH, WARNING_LIMIT, warningCopy, warningKey } from "@/lib/warnings";

// Giving and taking back warnings, against the database. No session check
// here: the admin actions in lib/actions/warning-actions.ts make it, and the
// tests call these directly.

export function warningsFor(employeeId: string) {
  return prisma.employeeWarning.findMany({
    where: { employeeId },
    orderBy: { createdAt: "asc" },
    select: { id: true, reason: true, createdAt: true },
  });
}

export type IssuedWarning = { warningId: string; number: number; accountClosed: boolean };

export async function issueWarning(employeeId: string, reasonInput: string): Promise<IssuedWarning> {
  const reason = reasonInput.trim();
  if (!reason) throw new Error("Write the reason for the warning.");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`Keep the reason under ${MAX_REASON_LENGTH} characters.`);
  }

  const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { active: true } });
  if (!employee) throw new Error("That employee no longer exists.");
  if (!employee.active) throw new Error("This account is disabled. Enable it before giving a warning.");

  const before = await prisma.employeeWarning.count({ where: { employeeId } });
  if (before >= WARNING_LIMIT) {
    throw new Error(`This employee already has ${WARNING_LIMIT} warnings. Remove one before giving another.`);
  }

  const warning = await prisma.employeeWarning.create({ data: { employeeId, reason } });
  const number = before + 1;
  const accountClosed = number >= WARNING_LIMIT;

  // Told first, while the account is still open: a closed account's
  // notifications are dropped, and this is the one that says why it closed.
  const copy = warningCopy(number, reason);
  await dispatchNotification({
    employeeId,
    type: "WARNING",
    title: copy.title,
    message: copy.message,
    url: DASHBOARD_PATH,
    dedupeKey: warningKey(warning.id),
    metadata: { warningId: warning.id, number },
  }).catch(() => {});

  if (accountClosed) {
    // The same as Disable account on the employee's page: signed out on their
    // next request, and their devices stop receiving.
    await prisma.employee.update({ where: { id: employeeId }, data: { active: false } });
    await prisma.pushSubscription.updateMany({ where: { employeeId }, data: { active: false } });
  }

  return { warningId: warning.id, number, accountClosed };
}

/**
 * Takes back a warning given by mistake. Reopening an account the last warning
 * closed stays a separate, deliberate step.
 */
export async function withdrawWarning(warningId: string) {
  const removed = await prisma.employeeWarning.deleteMany({ where: { id: warningId } });
  return removed.count > 0;
}
