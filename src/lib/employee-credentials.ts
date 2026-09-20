import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

// One check of an employee's email and password, for the web sign-in action and
// the mobile API both.
//
// Two copies of a credential check is the arrangement that drifts, and the
// mobile one would be the copy nobody is looking at — the same reason the
// eleven copies of `requireAdmin` were collapsed into one. "Is this account
// still allowed in" is precisely the question you cannot afford two answers to.
//
// Not "use server": every export of one of those becomes callable over the
// network, and a credential check that can itself be called is a password
// oracle.

// A real bcrypt hash of nothing anybody knows. Comparing against it costs what
// a real comparison costs, so an unknown address cannot be told apart from a
// wrong password by how long the answer took.
const DUMMY_HASH = "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva";

/**
 * The employee behind these credentials, or null.
 *
 * Null is the single answer to a wrong password, an unknown address, a disabled
 * account and somebody who is not on the team — the caller must not be able to
 * tell which, and neither must whoever is typing. Callers phrase their own "not
 * signed in" message; this one never explains itself.
 *
 * Stamps `lastLoginAt` on success, as the web action always did.
 */
export async function verifyEmployeeCredentials(
  email: string,
  password: string
): Promise<{ id: string; name: string } | null> {
  const normalised = email.trim().toLowerCase();
  if (!normalised || !password) return null;

  const employee = await prisma.employee.findUnique({ where: { email: normalised } });

  if (!employee?.passwordHash || !employee.active || employee.accessRole !== "EMPLOYEE") {
    // Spend the time anyway so a missing account is not detectably faster.
    await bcrypt.compare(password, DUMMY_HASH);
    return null;
  }

  if (!(await bcrypt.compare(password, employee.passwordHash))) return null;

  await prisma.employee.update({ where: { id: employee.id }, data: { lastLoginAt: new Date() } });

  return { id: employee.id, name: employee.name };
}
