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
import { PhotoPicker } from "@/components/employee/photo-picker";
import { setMyPhoto } from "@/lib/actions/employee-actions";

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

  // The new UI (2026-11-18): who you are across the top, then what reaches
  // you and on which devices side by side on a desk; one column on a phone.
  return (
    <div className="wide-page flex flex-col gap-6">
      <section aria-label="You" className="glass flex flex-col gap-5 rounded-2xl p-5 lg:flex-row lg:items-center">
        <div className="min-w-0 lg:flex-1">
          <h1 className="text-xl font-semibold text-ink">{employee.name}</h1>
          <p className="mt-1 text-sm text-ink/50">{employee.role ?? "Employee"}</p>
          <div className="mt-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:gap-x-6">
            {employee.email && <Line icon={Mail} value={employee.email} />}
            {employee.phone && <Line icon={Phone} value={employee.phone} />}
            {employee.employeeCode && <Line icon={IdCard} value={`ID ${employee.employeeCode}`} />}
            <Line icon={Smartphone} value={`${receiving} device${receiving === 1 ? "" : "s"} receiving push`} />
          </div>
        </div>
        <div className="lg:w-80">
          <PhotoPicker
            name={employee.name}
            photo={employee.photoUrl}
            color={employee.color}
            action={setMyPhoto}
            hint="Your picture in chat, on task cards and in calls."
          />
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-ink">Notifications</h2>
          <PushToggle publicKey={await getPublicKey()} configured={await isPushConfigured()} />
          <SoundToggle />
          <PreferencesForm preferences={preferences} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-2xl text-ink">Devices</h2>
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
          <p className="text-[11px] text-ink/40">Times shown in {timezone.replace("_", " ")}</p>
          <div className="mt-2">
            <SignOutButton />
          </div>
        </section>
      </div>
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
