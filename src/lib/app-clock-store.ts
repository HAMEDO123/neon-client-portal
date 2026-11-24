import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/admin-notifications";
import { APP_CLOCK_PLACES, asPunches, checkClockPlace, clockedInAlert, distanceMetres, isDoubleTap, mapLink, rawFix, readClockFix, readClockPlaces, refusedClockAlert, type ClockFix } from "@/lib/app-clock";
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

type RawPosition = { latitude: unknown; longitude: unknown; accuracy: unknown; fixedAt: unknown };

/**
 * A press of "Clock in here", from the iPhone app or the website: the position
 * read, the punch kept — and the try written down either way, refused ones
 * included, with where the phone said it was. A refused try also tells the
 * manager (asked for on 2026-11-24: "خليه يحفظ كل محاولة بصمة من التلفون
 * وخليه يسجل الموقع"). Refusals still reach the caller as before.
 */
export async function clockInFromApp(employeeId: string, raw: RawPosition, source: "app" | "web", now: Date = new Date()) {
  const seen = rawFix(raw);
  const place = readClockPlaces(await getSetting(APP_CLOCK_PLACES))[employeeId] ?? null;
  const distance =
    place && seen.latitude !== null && seen.longitude !== null
      ? Math.round(distanceMetres({ latitude: seen.latitude, longitude: seen.longitude }, place))
      : null;
  const keep = (outcome: "RECORDED" | "REPEATED" | "REFUSED", reason: string | null) =>
    prisma.appClockAttempt
      .create({
        data: { employeeId, at: now, source, outcome, reason, ...seen, distanceMetres: distance },
        select: { id: true },
      })
      .catch((error) => {
        // The record of a try must never undo the try itself.
        console.error("[app-clock-attempt]", error);
        return null;
      });

  try {
    const punch = await recordAppPunch(employeeId, readClockFix(raw, now), now);
    await keep(punch.repeated ? "REPEATED" : "RECORDED", null);
    return punch;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    const attempt = await keep("REFUSED", error.message);
    const who = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } });
    await notifyAdmin({
      type: "ATTENDANCE",
      ...refusedClockAlert(who?.name ?? "Somebody", formatTimeIn(await getTimezone(), now) ?? "", error.message, seen, distance),
      url: "/admin/attendance#app",
      dedupeKey: `APP_CLOCK_REFUSED:${attempt?.id ?? `${employeeId}:${now.toISOString()}`}`,
      employeeId,
    }).catch(() => undefined);
    throw error;
  }
}

/** Every try from the app in a span, newest first, refused ones included. */
export async function appClockAttemptsBetween(from: Date, to: Date) {
  return prisma.appClockAttempt.findMany({
    where: { at: { gte: from, lt: to } },
    orderBy: { at: "desc" },
    take: 300,
    select: {
      id: true,
      at: true,
      source: true,
      outcome: true,
      reason: true,
      latitude: true,
      longitude: true,
      accuracy: true,
      distanceMetres: true,
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
  const place = readClockPlaces(await getSetting(APP_CLOCK_PLACES))[employeeId];
  checkClockPlace(fix, place);

  const row = await prisma.appPunch.create({
    data: { employeeId, at: now, latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy },
    select: { id: true, at: true },
  });

  // The manager is told at once, with the exact spot — the owner, 2026-11-21:
  // "it must show me also the exact location he clocked in". The month's list
  // on /admin/attendance has the same punch with its map link.
  const who = await prisma.employee.findUnique({ where: { id: employeeId }, select: { name: true } });
  await notifyAdmin({
    type: "ATTENDANCE",
    ...clockedInAlert(who?.name ?? "Somebody", formatTimeIn(await getTimezone(), row.at) ?? "", fix, place ?? null),
    url: "/admin/attendance",
    dedupeKey: `APP_CLOCK_IN:${row.id}`,
    employeeId,
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
