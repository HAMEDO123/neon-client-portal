import { prisma } from "@/lib/db";
import { sessionEmployeeId } from "@/lib/session-token";

// The single place an employee's identity is derived. Nothing in the employee
// portal takes an employee id from the client — every read and write starts
// here, from the signed token (the cookie, or the phone app's bearer header —
// lib/session-token.ts), so one employee can never address another's data by
// changing an id in a request.

export type SessionEmployee = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
  employeeCode: string | null;
  color: string;
  /** Whether this person may use the company WhatsApp — see requireWhatsAppAccess. */
  canReadWhatsApp: boolean;
  /** Whether this person may hand work out to the team — see requireTaskAssigner. */
  canAssignTasks: boolean;
  /** Whether this person keeps the site-visit diary — see requireSiteVisitor. */
  canLogSiteVisits: boolean;
};

export async function getSessionEmployee(): Promise<SessionEmployee | null> {
  const employeeId = await sessionEmployeeId();
  if (!employeeId) return null;

  // A valid token is not enough: the account must still exist, still be
  // enabled, and still hold the employee role. Disabling someone in the admin
  // portal therefore locks them out on their very next request.
  const employee = await prisma.employee.findFirst({
    where: { id: employeeId, active: true, accessRole: "EMPLOYEE" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      phone: true,
      employeeCode: true,
      color: true,
      canReadWhatsApp: true,
      canAssignTasks: true,
      canLogSiteVisits: true,
    },
  });

  return employee;
}

export async function requireEmployee(): Promise<SessionEmployee> {
  const employee = await getSessionEmployee();
  if (!employee) throw new Error("Unauthorized");
  return employee;
}
