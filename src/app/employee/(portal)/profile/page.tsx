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
import { dateToDayKey, dayKeyToDate, formatDayIn, formatTimeIn, todayKey } from "@/lib/time";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { periodBounds, periodDayKeys, periodOf, periodRangeLabel } from "@/lib/pay-period";
import { myMonth, type MyMonthDay } from "@/lib/my-month";
import { avatarUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
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

  // This pay period (the 5th to the 4th, lib/pay-period.ts): the days as
  // squares and two numbers. One query after the other, like the other pages.
  const hours = await getWorkHours();
  const today = todayKey(timezone);
  const period = periodOf(today);
  const { from, to } = periodBounds(period);
  const records = await prisma.attendanceRecord.findMany({
    where: { employeeId: employee.id, day: { gte: dayKeyToDate(from), lte: dayKeyToDate(to) } },
    select: { day: true, delayHours: true },
  });
  const month = myMonth(
    periodDayKeys(period),
    today,
    hours,
    records.map((record) => ({ dayKey: dateToDayKey(record.day) ?? "", delayHours: record.delayHours }))
  );
  const tasksDone = await prisma.assignedTask.count({
    where: { employeeId: employee.id, state: "DONE", completedAt: { gte: dayKeyToDate(from) } },
  });

  // Design 2 (chosen 2026-11-19): a staff badge in the accent colour down the
  // left, the period's numbers and its days across the top, and what reaches
  // you and on which devices underneath. One column on a phone, badge first.
  return (
    <div className="wide-page grid gap-4 lg:grid-cols-12 lg:gap-5">
      <div className="flex flex-col gap-4 lg:col-span-4 lg:row-span-2 lg:gap-5">
        <section aria-label="You" className="lq-accent flex flex-col gap-5 rounded-2xl p-6 text-white">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/85">NEON studio · staff</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- a face from our own /api/avatar or upload */}
          <img
            src={employee.photoUrl ?? avatarUrl(employee.name, employee.color)}
            alt=""
            width={144}
            height={144}
            className="mx-auto h-36 w-36 rounded-full object-cover shadow-[0_18px_36px_-18px_rgba(0,0,0,0.55)] ring-4 ring-white/25"
          />
          <div className="text-center">
            <h1 className="text-white">{employee.name}</h1>
            <p className="mt-1 text-sm font-medium text-white/85">{employee.role ?? "Employee"}</p>
          </div>
          <dl className="flex flex-col gap-2 border-t border-white/25 pt-4 text-sm">
            {employee.employeeCode && <Detail label="ID" value={employee.employeeCode} />}
            {employee.email && <Detail label="Email" value={employee.email} />}
            {employee.phone && <Detail label="Phone" value={employee.phone} />}
            <Detail label="Push" value={`${receiving} device${receiving === 1 ? "" : "s"}`} />
          </dl>
          {/* A staff card's stripe — decoration only. */}
          <span
            aria-hidden
            className="block h-8 rounded opacity-60"
            style={{
              background:
                "repeating-linear-gradient(90deg, #fff 0 2px, transparent 2px 5px, #fff 5px 6px, transparent 6px 10px)",
            }}
          />
        </section>

        <section aria-label="Your picture" className="glass rounded-2xl p-5">
          <PhotoPicker
            name={employee.name}
            photo={employee.photoUrl}
            color={employee.color}
            action={setMyPhoto}
            hint="Your picture in chat, on task cards and in calls."
          />
        </section>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:col-span-4 lg:gap-5">
        <Figure label="Days recorded" value={String(month.recorded)} of={`/${month.workingSoFar}`} />
        <Figure label="On time" value={month.percentOnTime === null ? "—" : `${month.percentOnTime}%`} accent />
        <Figure label="Tasks done" value={String(tasksDone)} wide note="this period" />
      </div>

      <section aria-label="This period" className="glass rounded-2xl p-5 lg:col-span-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">This period</h2>
          <span className="text-xs text-ink/55">{periodRangeLabel(period)}</span>
        </div>
        <MonthGrid days={month.days} />
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/65">
          <Key className="bg-clay" label="On time" />
          <Key className="bg-amber-400" label="Late" />
          <Key className="bg-ink/10" label="Nothing recorded" />
          <Key className="border border-dashed border-ink/25" label="Day off" />
        </ul>
      </section>

      <section className="flex flex-col gap-3 lg:col-span-5">
        <h2 className="text-2xl text-ink">Notifications</h2>
        <PushToggle publicKey={await getPublicKey()} configured={await isPushConfigured()} />
        <SoundToggle />
        <PreferencesForm preferences={preferences} />
      </section>

      <section className="flex flex-col gap-3 lg:col-span-3">
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
        <p className="text-[11px] text-ink/55">Times shown in {timezone.replace("_", " ")}</p>
        <div className="mt-2">
          <SignOutButton />
        </div>
      </section>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-white/80">{label}</dt>
      <dd dir="auto" className="min-w-0 truncate font-semibold">
        {value}
      </dd>
    </div>
  );
}

function Figure({
  label,
  value,
  of,
  note,
  accent = false,
  wide = false,
}: {
  label: string;
  value: string;
  of?: string;
  note?: string;
  accent?: boolean;
  wide?: boolean;
}) {
  return (
    <section className={cn("glass flex flex-col justify-between gap-4 rounded-2xl p-5", wide && "col-span-2")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink/55">{label}</p>
      <p className="flex items-baseline gap-2">
        <span className={cn("text-4xl font-semibold leading-none tabular-nums", accent ? "text-clay-deep" : "text-ink")}>
          {value}
        </span>
        {of && <span className="text-lg text-ink/55">{of}</span>}
        {note && <span className="ml-auto text-xs text-ink/55">{note}</span>}
      </p>
    </section>
  );
}

// The studio's week starts on a Saturday.
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const WEEK_LETTERS = ["Sa", "Su", "Mo", "Tu", "We", "Th", "Fr"];
const SQUARE: Record<MyMonthDay["state"], string> = {
  "on-time": "bg-clay text-white",
  late: "bg-amber-400 text-amber-950",
  none: "bg-ink/[0.07] text-ink/60",
  off: "border border-dashed border-ink/20 text-ink/45",
  future: "text-ink/40",
};
const SAID: Record<MyMonthDay["state"], string> = {
  "on-time": "on time",
  late: "late",
  none: "nothing recorded",
  off: "day off",
  future: "not yet",
};

function MonthGrid({ days }: { days: MyMonthDay[] }) {
  const lead = days.length > 0 ? WEEK.indexOf(days[0].weekday) : 0;
  return (
    <div className="mt-3 grid grid-cols-7 gap-1.5 text-center">
      {WEEK_LETTERS.map((letter) => (
        <span key={letter} aria-hidden className="text-[10px] font-semibold uppercase text-ink/50">
          {letter}
        </span>
      ))}
      {Array.from({ length: lead }, (_, index) => (
        <span key={`lead-${index}`} aria-hidden />
      ))}
      {days.map((day) => (
        <span
          key={day.dayKey}
          title={`${day.dayKey}: ${SAID[day.state]}`}
          aria-label={`${day.dayOfMonth}: ${SAID[day.state]}`}
          className={cn(
            "grid aspect-square place-items-center rounded-lg text-[11px] font-semibold tabular-nums",
            SQUARE[day.state],
            day.isToday && "ring-2 ring-ink ring-offset-1 ring-offset-card"
          )}
        >
          {day.dayOfMonth}
        </span>
      ))}
    </div>
  );
}

function Key({ className, label }: { className: string; label: string }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <span aria-hidden className={cn("h-3 w-3 rounded", className)} />
      {label}
    </li>
  );
}
