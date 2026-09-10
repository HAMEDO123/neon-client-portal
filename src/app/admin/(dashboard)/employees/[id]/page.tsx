import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, KeyRound, Power, Smartphone } from "lucide-react";
import { prisma } from "@/lib/db";
import {
  resetEmployeePassword,
  revokeEmployeeAccount,
  setEmployeeActive,
  updateEmployeeAccount,
} from "@/lib/actions/admin-employee-actions";
import { TextInput } from "@/components/admin/fields";
import { SaveButton, DeleteButton } from "@/components/admin/form-buttons";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/buttons";
import { formatDate } from "@/lib/format";
import { getTimezone } from "@/lib/settings";
import { EmployeeWarnings } from "@/components/admin/employee-warnings";

export default async function AdminEmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const employee = await prisma.employee.findUnique({
    where: { id },
    include: {
      subscriptions: { where: { active: true }, orderBy: { createdAt: "desc" } },
      warnings: { orderBy: { createdAt: "asc" }, select: { id: true, reason: true, createdAt: true } },
      _count: { select: { notifications: true, assignedEntries: true } },
    },
  });
  if (!employee) notFound();
  const timezone = await getTimezone();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link
          href="/admin/employees"
          className="inline-flex items-center gap-1.5 text-sm text-ink/45 hover:text-ink"
        >
          <ArrowLeft size={14} strokeWidth={1.75} />
          All employees
        </Link>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-ink">{employee.name}</h1>
          <Badge tone={employee.active ? "success" : "neutral"}>
            {employee.active ? "Active" : "Disabled"}
          </Badge>
          {!employee.email && <Badge tone="warning">No account</Badge>}
        </div>
        <p className="mt-1 text-sm text-ink/50">
          Added {formatDate(employee.createdAt)} ·{" "}
          {employee.lastLoginAt ? `last signed in ${formatDate(employee.lastLoginAt)}` : "never signed in"}
        </p>
      </div>

      <form
        action={updateEmployeeAccount.bind(null, employee.id)}
        className="glass grid grid-cols-1 gap-3 rounded-2xl p-6 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <h2 className="text-sm font-medium text-ink">Details</h2>
        </div>
        <TextInput label="Full name" name="name" defaultValue={employee.name} />
        <TextInput label="Email" name="email" type="email" defaultValue={employee.email ?? ""} required={false} />
        <TextInput label="Job title" name="role" defaultValue={employee.role ?? ""} required={false} />
        <TextInput label="Phone" name="phone" defaultValue={employee.phone ?? ""} required={false} />
        <TextInput
          label="Employee ID"
          name="employeeCode"
          defaultValue={employee.employeeCode ?? ""}
          required={false}
        />
        <div className="flex items-end">
          <SaveButton label="Save details" />
        </div>
      </form>

      <EmployeeWarnings
        employeeId={employee.id}
        name={employee.name}
        active={employee.active}
        warnings={employee.warnings}
        timezone={timezone}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <form action={resetEmployeePassword.bind(null, employee.id)} className="glass rounded-2xl p-6">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <KeyRound size={15} strokeWidth={2} />
            Set a new password
          </h2>
          <p className="mt-1 text-xs text-ink/45">
            The employee is notified in-app that their password changed. Existing sessions stay valid until they
            expire.
          </p>
          <div className="mt-3">
            <TextInput
              label="New password"
              name="password"
              type="password"
              placeholder="At least 8 characters"
              defaultValue=""
            />
          </div>
          <div className="mt-3">
            <SaveButton label="Update password" />
          </div>
        </form>

        <div className="glass flex flex-col rounded-2xl p-6">
          <h2 className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            <Power size={15} strokeWidth={2} />
            Account access
          </h2>
          <p className="mt-1 text-xs text-ink/45">
            Disabling takes effect on the employee&apos;s next request and stops all push to their devices. Their
            place on the task board is untouched.
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <form action={setEmployeeActive.bind(null, employee.id, !employee.active)}>
              <button type="submit" className={buttonClasses(employee.active ? "outline" : "primary", "sm")}>
                {employee.active ? "Disable account" : "Enable account"}
              </button>
            </form>

            {employee.email && (
              <form>
                <DeleteButton
                  formAction={revokeEmployeeAccount.bind(null, employee.id)}
                  label="Revoke login"
                  confirmMessage={`Remove ${employee.name}'s email and password? They stay on the task board but can no longer sign in.`}
                />
              </form>
            )}
          </div>

          <div className="mt-auto pt-4 text-xs text-ink/45">
            <p className="inline-flex items-center gap-1.5">
              <Smartphone size={12} strokeWidth={2} />
              {employee.subscriptions.length} device
              {employee.subscriptions.length === 1 ? "" : "s"} receiving push ·{" "}
              {employee._count.notifications} notification
              {employee._count.notifications === 1 ? "" : "s"} sent
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
