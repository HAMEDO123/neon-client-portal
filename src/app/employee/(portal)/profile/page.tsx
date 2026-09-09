import { LogOut, Mail, Phone, Smartphone, IdCard } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { employeeLogout } from "@/lib/actions/employee-auth-actions";
import { getPreferences } from "@/lib/notifications/engine";
import { getPublicKey, isPushConfigured } from "@/lib/notifications/push";
import { PushToggle } from "@/components/employee/push-toggle";
import { PreferencesForm } from "@/components/employee/preferences-form";
import { getTimezone } from "@/lib/settings";

export default async function EmployeeProfilePage() {
  const employee = await requireEmployee();

  const [preferences, devices, timezone] = await Promise.all([
    getPreferences(employee.id),
    prisma.pushSubscription.count({ where: { employeeId: employee.id, active: true } }),
    getTimezone(),
  ]);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{employee.name}</h1>
        <p className="mt-1 text-sm text-ink/50">{employee.role ?? "Employee"}</p>
      </div>

      <div className="glass flex flex-col gap-3 rounded-2xl p-4">
        {employee.email && <Line icon={Mail} value={employee.email} />}
        {employee.phone && <Line icon={Phone} value={employee.phone} />}
        {employee.employeeCode && <Line icon={IdCard} value={`ID ${employee.employeeCode}`} />}
        <Line
          icon={Smartphone}
          value={`${devices} device${devices === 1 ? "" : "s"} receiving push`}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Notifications</h2>
        <PushToggle publicKey={await getPublicKey()} configured={await isPushConfigured()} />
        <PreferencesForm preferences={preferences} />
      </section>

      <p className="text-center text-[11px] text-ink/35">Times shown in {timezone.replace("_", " ")}</p>

      <form action={employeeLogout}>
        <button
          type="submit"
          className="flex h-12 w-full items-center justify-center gap-2 rounded-full border border-ink/12 bg-white/60 text-sm font-medium text-ink/60 transition-colors hover:text-ink"
        >
          <LogOut size={16} strokeWidth={1.75} />
          Sign out
        </button>
      </form>
    </div>
  );
}

function Line({ icon: Icon, value }: { icon: typeof Mail; value: string }) {
  return (
    <p className="inline-flex items-center gap-2.5 text-sm text-ink/70">
      <Icon size={15} strokeWidth={1.75} className="shrink-0 text-ink/35" />
      <span className="truncate">{value}</span>
    </p>
  );
}
