import Link from "next/link";
import { ArrowRight, ShieldCheck, UserPlus, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { createEmployeeAccount } from "@/lib/actions/admin-employee-actions";
import { TextInput } from "@/components/admin/fields";
import { SaveButton } from "@/components/admin/form-buttons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import { WARNING_LIMIT } from "@/lib/warnings";

export default async function AdminEmployeesPage() {
  const employees = await prisma.employee.findMany({
    orderBy: [{ active: "desc" }, { order: "asc" }],
    include: {
      _count: { select: { tasks: true, assignedEntries: true, subscriptions: true, warnings: true } },
    },
  });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">Employees</h1>
          <p className="mt-1 text-sm text-ink/50">
            Team accounts for the employee portal. Everyone here signs in at{" "}
            <span className="font-medium text-ink/70">/employee</span> and sees only their own tasks.
          </p>
        </div>
      </div>

      <form
        action={createEmployeeAccount}
        className="glass mt-6 grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-3"
      >
        <div className="sm:col-span-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <UserPlus size={15} strokeWidth={2} />
            Add an employee
          </h2>
        </div>

        <TextInput label="Full name" name="name" placeholder="Ahmed Nasser" defaultValue="" />
        <TextInput label="Email" name="email" type="email" placeholder="ahmed@company.com" defaultValue="" />
        <TextInput label="Password" name="password" type="password" placeholder="At least 8 characters" defaultValue="" />
        <TextInput label="Job title" name="role" placeholder="3D Visualizer" defaultValue="" required={false} />
        <TextInput label="Phone" name="phone" placeholder="+962 7 0000 0000" defaultValue="" required={false} />
        <TextInput label="Employee ID" name="employeeCode" placeholder="NEON-014" defaultValue="" required={false} />

        <div className="sm:col-span-3">
          <SaveButton label="Create account" />
        </div>
      </form>

      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-ink/40">Team</h2>

      {employees.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={Users}
          title="No employees yet"
          description="Create the first account above — they can then sign in to the employee portal."
        />
      ) : (
        <>
          {/* On a phone, a card per person that opens them: the table needs six columns. */}
          <ul className="mt-4 flex flex-col gap-2 sm:hidden">
            {employees.map((employee) => (
              <li key={employee.id}>
                <Link
                  href={`/admin/employees/${employee.id}`}
                  className="glass flex items-center gap-3 rounded-2xl p-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{employee.name}</p>
                      <AccountBadge email={employee.email} active={employee.active} />
                      <WarningsBadge count={employee._count.warnings} />
                    </div>
                    {employee.role && <p className="mt-0.5 text-xs text-ink/45">{employee.role}</p>}
                    <p className="mt-1 truncate text-xs text-ink/50">{employee.email ?? "Board only — no login"}</p>
                    <p className="mt-0.5 text-xs text-ink/40">
                      {employee._count.tasks} step{employee._count.tasks === 1 ? "" : "s"}
                      {employee._count.subscriptions > 0 &&
                        ` · ${employee._count.subscriptions} device${employee._count.subscriptions === 1 ? "" : "s"}`}
                      {" · "}
                      {employee.lastLoginAt ? `Signed in ${formatDate(employee.lastLoginAt)}` : "Never signed in"}
                    </p>
                  </div>
                  <ArrowRight size={16} strokeWidth={2} className="shrink-0 text-ink/25" />
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-4 hidden overflow-x-auto rounded-2xl border border-ink/8 sm:block">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink/[0.03] text-xs uppercase tracking-wider text-ink/40">
                <tr>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3">Account</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Work</th>
                  <th className="px-4 py-3">Last sign-in</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {employees.map((employee) => (
                  <tr key={employee.id} className="border-t border-ink/6">
                    <td className="px-4 py-3">
                      <p className="font-medium text-ink">{employee.name}</p>
                      {employee.role && <p className="text-xs text-ink/45">{employee.role}</p>}
                    </td>
                    <td className="px-4 py-3 text-ink/60">
                      {employee.email ?? <span className="text-ink/30">Board only — no login</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AccountBadge email={employee.email} active={employee.active} />
                        <WarningsBadge count={employee._count.warnings} />
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50">
                      {employee._count.tasks} step{employee._count.tasks === 1 ? "" : "s"}
                      {employee._count.subscriptions > 0 && (
                        <span className="ml-2 inline-flex items-center gap-1 text-ink/40">
                          <ShieldCheck size={11} strokeWidth={2} />
                          {employee._count.subscriptions} device
                          {employee._count.subscriptions === 1 ? "" : "s"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50">
                      {employee.lastLoginAt ? formatDate(employee.lastLoginAt) : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/admin/employees/${employee.id}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-ink/50 hover:text-ink"
                      >
                        Manage
                        <ArrowRight size={13} strokeWidth={2} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/** Whether they can sign in: someone on the board without an email has no account. */
function AccountBadge({ email, active }: { email: string | null; active: boolean }) {
  if (!email) return <Badge tone="warning">No account</Badge>;
  return <Badge tone={active ? "success" : "neutral"}>{active ? "Active" : "Disabled"}</Badge>;
}

/** Warnings on record, when there are any. The third closes the account. */
function WarningsBadge({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <Badge tone="warning">
      {count}/{WARNING_LIMIT} warnings
    </Badge>
  );
}
