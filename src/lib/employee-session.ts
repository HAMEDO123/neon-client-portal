import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { EMPLOYEE_SESSION_COOKIE_NAME, verifyEmployeeSessionToken } from "@/lib/auth";

// The single place an employee's identity is derived. Nothing in the employee
// portal takes an employee id from the client — every read and write starts
// here, from the signed cookie, so one employee can never address another's
// data by changing an id in a request.

export type SessionEmployee = {
  id: string;
  name: string;
  email: string | null;
  role: string | null;
  phone: string | null;
  employeeCode: string | null;
  color: string;
};

export async function getSessionEmployee(): Promise<SessionEmployee | null> {
  const store = await cookies();
  const employeeId = verifyEmployeeSessionToken(store.get(EMPLOYEE_SESSION_COOKIE_NAME)?.value);
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
    },
  });

  return employee;
}

export async function requireEmployee(): Promise<SessionEmployee> {
  const employee = await getSessionEmployee();
  if (!employee) throw new Error("Unauthorized");
  return employee;
}
