import { prisma } from "@/lib/db";
import { APP_CLOCK_PLACES, asPunches, checkClockPlace, isDoubleTap, mapLink, readClockPlaces, type ClockFix } from "@/lib/app-clock";
import { getSetting, getTimezone } from "@/lib/settings";
import { dayKeyIn, dayKeyToDate, formatTimeIn, instantAt, shiftDayKey } from "@/lib/time";
import type { Punch } from "@/lib/attendance";
import { Refusal } from "@/lib/refusal";

// The database side of clocking in from the app (lib/app-clock.ts).
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have checked who is asking.

/** Every app punch from `since` on, as the sync reads punches. */
export async function appPunchesSince(since: Date): Promise<Punch[]> {
  const rows = await prisma.appPunch.findMany({
    where: { at: { gte: since } },
    orderBy: { at: "asc" },
    select: { employeeId: true, at: true, employee: { select: { deviceUserId: true } } },
  });
  const numbers = new Map(rows.map((row) => [row.employeeId, row.employee.deviceUserId]));
  return asPunches(rows, (employeeId) => numbers.get(employeeId));
}

/** One person's app punches in a span, with where each was made. */
export async function appPunchesBetween(from: Date, to: Date, employeeId?: string) {
  return prisma.appPunch.findMany({
    where: { at: { gte: from, lt: to }, ...(employeeId ? { employeeId } : {}) },
    orderBy: { at: "asc" },
    select: {
      id: true,
      employeeId: true,
      at: true,
      latitude: true,
      longitude: true,
      accuracy: true,
      employee: { select: { name: true } },
    },
  });
}

/**
 * Keeps one punch from the app, with its place.
 *
 * Refused for anybody the manager has not turned it on for — the device is how
 * everybody else clocks in, and a button that worked for anyone would make the
 * device optional for the whole team. A second press inside a minute is the
 * same punch and answers with it.
 */
export async function recordAppPunch(employeeId: string, fix: ClockFix, now: Date = new Date()) {
  const person = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { appClockIn: true, active: true },
  });
  if (!person?.active || !person.appClockIn) {
    throw new Refusal("Clocking in from the app isn't on for you — use the fingerprint at the studio.");
  }
  // The app clocks people in and nothing more: the clock-out is on the
  // fingerprint at the studio — the owner, 2026-11-21: "the clock out from
  // inside the company". A second press inside a minute is still the same
  // punch (just below), so a double tap on the way in is not refused.
  const last = await prisma.appPunch.findFirst({
    where: { employeeId },
    orderBy: { at: "desc" },
    select: { id: true, at: true },
  });
  if (last && isDoubleTap(last.at, now)) return { id: last.id, at: last.at, repeated: true };
  if (await arrivedToday(employeeId, now)) {
    throw new Refusal("You're already clocked in today. Clock out on the fingerprint at the studio.");
  }

  // And only from their place, for somebody the manager gave one
  // (APP_CLOCK_PLACES): "for wael clock in outside the office he should
  // around this coordinates 31.977115, 35.866423".
  checkClockPlace(fix, readClockPlaces(await getSetting(APP_CLOCK_PLACES))[employeeId]);

  const row = await prisma.appPunch.create({
    data: { employeeId, at: now, latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy },
    select: { id: true, at: true },
  });
  return { ...row, repeated: false };
}

/** Whether today already has an arrival for this person: a read from the fingerprint or an app punch. */
async function arrivedToday(employeeId: string, now: Date) {
  const timeZone = await getTimezone();
  const dayKey = dayKeyIn(timeZone, now);
  const record = await prisma.attendanceRecord.findUnique({
    where: { employeeId_day: { employeeId, day: dayKeyToDate(dayKey) } },
    select: { arrivedAt: true },
  });
  if (record?.arrivedAt) return true;
  const from = instantAt(dayKey, "00:00", timeZone);
  if (!from) return false;
  return (await prisma.appPunch.count({ where: { employeeId, at: { gte: from } } })) > 0;
}

/**
 * What the home page's clock card shows about the app: null for anybody it is
 * not on for, and today's punches from it for whoever it is.
 */
export async function myAppClock(employeeId: string, dayKey: string, timeZone: string) {
  const person = await prisma.employee.findUnique({ where: { id: employeeId }, select: { appClockIn: true } });
  if (!person?.appClockIn) return null;

  const from = instantAt(dayKey, "00:00", timeZone);
  const to = instantAt(shiftDayKey(dayKey, 1), "00:00", timeZone);
  if (!from || !to) return { punches: [] };

  const rows = await appPunchesBetween(from, to, employeeId);
  return {
    punches: rows.map((row) => ({ time: formatTimeIn(timeZone, row.at) ?? "", link: mapLink(row) })),
  };
}
