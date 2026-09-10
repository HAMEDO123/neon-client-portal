import { Mail, Phone, Smartphone, IdCard } from "lucide-react";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { getPreferences } from "@/lib/notifications/engine";
import { getPublicKey, isPushConfigured } from "@/lib/notifications/push";
import { PushToggle } from "@/components/employee/push-toggle";
import { SoundToggle } from "@/components/sound-toggle";
import { PreferencesForm } from "@/components/employee/preferences-form";
import { DeviceList } from "@/components/employee/device-list";
import { SignOutButton } from "@/components/employee/sign-out-button";
import { deviceLabel } from "@/lib/devices";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { getTimezone } from "@/lib/settings";

export default async function EmployeeProfilePage() {
  const employee = await requireEmployee();

  const [preferences, devices, timezone] = await Promise.all([
    getPreferences(employee.id),
    // Every device this account has registered, muted ones included — a device
    // you cannot see is a device you cannot switch back on.
    prisma.pushSubscription.findMany({
      where: { employeeId: employee.id },
      orderBy: [{ active: "desc" }, { lastUsedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, endpoint: true, userAgent: true, active: true, lastUsedAt: true, createdAt: true },
    }),
    getTimezone(),
  ]);

  const receiving = devices.filter((device) => device.active).length;

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
          value={`${receiving} device${receiving === 1 ? "" : "s"} receiving push`}
        />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Notifications</h2>
        <PushToggle publicKey={await getPublicKey()} configured={await isPushConfigured()} />
        <SoundToggle />
        <DeviceList
          devices={devices.map((device) => ({
            id: device.id,
            endpoint: device.endpoint,
            label: deviceLabel(device.userAgent),
            active: device.active,
            lastUsedAt: device.lastUsedAt
              ? `${formatDayIn(timezone, device.lastUsedAt)} ${formatTimeIn(timezone, device.lastUsedAt)}`
              : null,
            addedAt: formatDayIn(timezone, device.createdAt) ?? "",
          }))}
        />
        <PreferencesForm preferences={preferences} />
      </section>

      <p className="text-center text-[11px] text-ink/35">Times shown in {timezone.replace("_", " ")}</p>

      <SignOutButton />
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
