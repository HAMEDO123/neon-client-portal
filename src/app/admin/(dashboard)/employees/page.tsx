import Link from "next/link";
import { ArrowRight, UserPlus, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { createEmployeeAccount } from "@/lib/actions/admin-employee-actions";
import { TextInput } from "@/components/admin/fields";
import { SaveButton } from "@/components/admin/form-buttons";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/lib/format";
import { WARNING_LIMIT } from "@/lib/warnings";
import { salesCountsForMonth } from "@/lib/sales-queries";
import { getTimezone } from "@/lib/settings";
import { periodOf } from "@/lib/payroll";
import { todayKey } from "@/lib/time";

export default async function AdminEmployeesPage() {
  const employees = await prisma.employee.findMany({
    orderBy: [{ active: "desc" }, { order: "asc" }],
    include: {
      _count: { select: { tasks: true, assignedEntries: true, subscriptions: true, warnings: true } },
    },
  });

  // This month's sales, for the target badge beside each name.
  const timezone = await getTimezone();
  const sold = await salesCountsForMonth(periodOf(todayKey(timezone)));

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

      <form action={createEmployeeAccount} className="glass mt-6 grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-3">
        <div className="sm:col-span-3">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <UserPlus size={15} strokeWidth={2} />
            Add an employee
          </h2>
        </div>

        <TextInput label="Full name" name="name" placeholder="Ahmed Nasser" defaultValue="" />
        <TextInput label="Email" name="email" type="email" placeholder="ahmed@company.com" defaultValue="" />
        <TextInput
          label="Password"
          name="password"
          type="password"
          placeholder="At least 8 characters"
          defaultValue=""
        />
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
          {/* A card per person that opens them, on every screen (the new UI,
              2026-11-18) — the six-column table it replaced on a desk said the
              same things less readably. */}
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {employees.map((employee) => (
              <li key={employee.id}>
                <Link
                  href={`/admin/employees/${employee.id}`}
                  className="glass flex items-center gap-3 rounded-2xl p-4"
                >
                  <PersonAvatar name={employee.name} photo={employee.photoUrl} color={employee.color} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-ink">{employee.name}</p>
                      <AccountBadge email={employee.email} active={employee.active} />
                      <WarningsBadge count={employee._count.warnings} />
                      <SalesBadge sold={sold.get(employee.id) ?? 0} target={employee.monthlySalesTarget} />
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

/** This month against the sales target, green once it is met. */
function SalesBadge({ sold, target }: { sold: number; target: number }) {
  if (target === 0) return null;
  return (
    <Badge tone={sold >= target ? "success" : "neutral"}>
      {sold}/{target} sold
    </Badge>
  );
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
