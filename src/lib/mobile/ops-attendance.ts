import { prisma } from "@/lib/db";
import { deviceAddress, readClock, readDeviceUsers, type DeviceClock, type DeviceUser } from "@/lib/attendance-device";
import { mappedByDeviceUser } from "@/lib/attendance-store";
import { MAX_DRIFT_SECONDS } from "@/lib/attendance-sync";
import { buildMonth, monthBounds, monthKeyFor, type Month, type MonthEntry } from "@/lib/attendance-month";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dateToDayKey, dayKeyToDate, todayKey } from "@/lib/time";

// Gathers what the admin/(dashboard)/attendance page reads, for the phone's
// registry entries. Every function here calls exactly the same lib queries the
// page does — nothing is re-derived — so this is composition, not new logic.

export type AttendanceOverview = {
  device: { ip: string; port: number } | null;
  reachError: string | null;
  clock: { wallClock: string; driftSeconds: number } | null;
  driftBad: boolean;
  users: DeviceUser[];
  canReach: boolean;
  employees: { id: string; name: string; role: string | null; deviceUserId: string | null }[];
  paired: { deviceUserId: string; name: string; active: boolean }[];
};

export async function attendanceOverview(): Promise<AttendanceOverview> {
  const at = deviceAddress();
  const timezone = await getTimezone();

  let clock: DeviceClock | null = null;
  let users: DeviceUser[] = [];
  let reachError: string | null = null;

  if (at) {
    try {
      // One after the other: the device holds few connections.
      clock = await readClock(at, timezone);
      users = await readDeviceUsers(at);
    } catch (error) {
      reachError = error instanceof Error ? error.message : String(error);
    }
  }

  const mapped = await mappedByDeviceUser();
  const employees = await prisma.employee.findMany({
    where: { active: true },
    orderBy: { order: "asc" },
    select: { id: true, name: true, role: true, deviceUserId: true },
  });

  return {
    device: at,
    reachError,
    clock: clock ? { wallClock: clock.wallClock, driftSeconds: clock.driftSeconds } : null,
    driftBad: clock ? Math.abs(clock.driftSeconds) > MAX_DRIFT_SECONDS : false,
    users,
    canReach: Boolean(at) && !reachError,
    employees,
    paired: [...mapped.values()].map((person) => ({
      deviceUserId: person.deviceUserId as string,
      name: person.name,
      active: person.active,
    })),
  };
}

export type AttendanceMonthResponse = Month & { thisMonth: string };

export async function attendanceMonthFor(askedMonth: string | null): Promise<AttendanceMonthResponse> {
  const timezone = await getTimezone();
  const thisMonth = todayKey(timezone).slice(0, 7);
  const monthKey = monthKeyFor(askedMonth, todayKey(timezone));
  const bounds = monthBounds(monthKey);
  const workHours = await getWorkHours();

  const employees = await prisma.employee.findMany({
    where: { active: true },
    orderBy: { order: "asc" },
    select: { id: true, name: true },
  });

  const monthRecords = await prisma.attendanceRecord.findMany({
    where: { day: { gte: dayKeyToDate(bounds.from), lte: dayKeyToDate(bounds.to) } },
    orderBy: [{ day: "asc" }],
    include: { employee: { select: { id: true, name: true, active: true } } },
  });

  const entries: MonthEntry[] = monthRecords.flatMap((row) => {
    const dayKey = dateToDayKey(row.day);
    return dayKey
      ? [
          {
            employeeId: row.employeeId,
            dayKey,
            delayHours: row.delayHours,
            // The same reading as the admin attendance page: hours left
            // unworked at the end, and whether a clock-out exists at all.
            earlyHours: row.earlyHours,
            clockedOut: row.departedAt !== null,
            source: row.source,
            note: row.note,
          },
        ]
      : [];
  });

  const seen = new Set(employees.map((person) => person.id));
  const people = [
    ...employees.map((person) => ({ id: person.id, name: person.name, active: true })),
    ...monthRecords
      .map((row) => row.employee)
      .filter((person) => !seen.has(person.id) && (seen.add(person.id), true))
      .map((person) => ({ id: person.id, name: person.name, active: person.active })),
  ];

  const month = buildMonth({ monthKey, hours: workHours, todayKey: todayKey(timezone), people, entries });
  return { ...month, thisMonth };
}
