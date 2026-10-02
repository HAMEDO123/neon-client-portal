import { prisma } from "@/lib/db";
import { RpcError } from "@/lib/mobile/rpc";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH } from "@/lib/notifications/types";
import { periodOf, periodRange } from "@/lib/payroll";
import { getSetting, getTimezone, getWorkHours, setSetting } from "@/lib/settings";
import { dateToDayKey, dayKeyIn, dayKeyToDate } from "@/lib/time";
import type { WorkHours } from "@/lib/work-hours";
import {
  dayName,
  FINE_ANNOUNCED_KEY,
  FINE_KEY,
  FINE_KIND,
  fineKey,
  fineRule,
  fineStartsOn,
  fineSwitch,
  finesByMonth,
  forgiveArgs,
  forgivenCopy,
  forgivenKey,
  managerFineKey,
  monthAdjustment,
  noticeKey,
  readAnnouncedAt,
  readFineOn,
  toldAt,
  type FineRule,
} from "@/lib/location-fine";

// The 1 JOD a working day without location, in the database: the switch and
// the notice, the day's count of positions, the charge and its undo, and the
// month's SalaryAdjustment row counted again from the days. The rules are
// lib/location-fine.ts; the scheduler's half is lib/notifications/location-fines.ts.
//
// Whether somebody's phone shared is kept as a count and two times on
// LocationDay — never where. The map's coordinates are wiped when the day
// closes; this is what the charge is decided on instead, and it holds nothing
// a position could be read back from.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have checked who is asking.

/** The day the fine is read for: the studio's calendar day, and what its window is made of. */
export type FineToday = { dayKey: string; day: Date; timeZone: string; hours: WorkHours };

// --- The switch and the notice -------------------------------------------------------

/** Whether the rule is on, and when it was announced — both settings in one read. */
export async function fineSettings(): Promise<{ on: boolean; stamp: string | null; announcedAt: Date | null }> {
  const rows = await prisma.appSetting.findMany({ where: { key: { in: [FINE_KEY, FINE_ANNOUNCED_KEY] } } });
  const saved = new Map(rows.map((row) => [row.key, row.value]));
  const stamp = saved.get(FINE_ANNOUNCED_KEY) ?? null;
  const announcedAt = readAnnouncedAt(stamp);
  return { on: readFineOn(saved.get(FINE_KEY)), stamp: announcedAt ? stamp : null, announcedAt };
}

/** The rule as the map shows it: on or off, and the first working day that counts since it was announced. */
async function ruleNow(today?: Pick<FineToday, "hours" | "timeZone">): Promise<FineRule> {
  const settings = await fineSettings();
  if (!settings.on || !settings.announcedAt) return fineRule(settings.on, null);
  const timeZone = today?.timeZone ?? (await getTimezone());
  const hours = today?.hours ?? (await getWorkHours());
  return fineRule(true, fineStartsOn({ hours, announcedAt: settings.announcedAt, timeZone }));
}

/**
 * `team/locations/fine`: args [true | false] → { fine }.
 *
 * Off deletes the announcement, and so does coming back on from off: the next
 * keeper pass tells everybody again, and only days that start after that
 * count. A notice from before a pause is not notice of what happens after it.
 */
export async function setLocationFine(args: unknown[]): Promise<{ fine: FineRule }> {
  const on = fineSwitch(args);
  const was = readFineOn(await getSetting(FINE_KEY));
  await setSetting(FINE_KEY, on ? "true" : "false");
  if (!on || !was) await prisma.appSetting.deleteMany({ where: { key: FINE_ANNOUNCED_KEY } });
  return { fine: await ruleNow() };
}

/**
 * Stamps the announcement unless one is there, and answers whichever stamp is.
 * Two passes at once both get here; the insert lets one of them write it and
 * both read the same one back, so the notice keyed on it goes out once.
 */
export async function claimAnnouncement(now: Date): Promise<string> {
  const stamp = now.toISOString();
  await prisma.appSetting.createMany({ data: [{ key: FINE_ANNOUNCED_KEY, value: stamp }], skipDuplicates: true });
  const kept = await prisma.appSetting.findUnique({ where: { key: FINE_ANNOUNCED_KEY } });
  if (kept && readAnnouncedAt(kept.value)) return kept.value;
  // Something that is not a time was in the way: this announcement replaces it.
  await setSetting(FINE_ANNOUNCED_KEY, stamp);
  return stamp;
}

/** When each of these people was told about the rule, for this announcement — the notice's own row. */
export async function noticesSent(stamp: string, employeeIds: string[]): Promise<Map<string, Date>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await prisma.notification.findMany({
    where: { dedupeKey: { in: employeeIds.map((id) => noticeKey(id, stamp)) } },
    select: { employeeId: true, createdAt: true },
  });
  return new Map(rows.map((row) => [row.employeeId, row.createdAt]));
}

// --- The day ------------------------------------------------------------------------

/**
 * One more position stored from this phone today. Called by `reportLocation`
 * only once the position is kept — inside the window, and newer than the one
 * before it, so a "still here" counts and a report that lost the race to a
 * newer one does not.
 *
 * The count is an increment inside the write, so two reports at once both
 * count. The times move only forward (`lastAt`) or back (`firstAt`), each with
 * its condition in the UPDATE, for the same reason the map's position does.
 */
export async function countFix(employeeId: string, day: Date, fixedAt: Date) {
  const add = () =>
    prisma.locationDay.upsert({
      where: { employeeId_day: { employeeId, day } },
      create: { employeeId, day, fixes: 1, firstAt: fixedAt, lastAt: fixedAt },
      update: { fixes: { increment: 1 } },
      select: { firstAt: true, lastAt: true },
    });
  // Prisma writes this as one INSERT … ON CONFLICT DO UPDATE, so two first
  // reports of the day at once both count. Should it ever fall back to a read
  // and a write, the one that loses the race to create the row finds it there
  // on a second try and counts into it.
  const row = await add().catch((error) => (isUniqueViolation(error) ? add() : Promise.reject(error)));

  if (!row.lastAt || row.lastAt.getTime() < fixedAt.getTime()) {
    await prisma.locationDay.updateMany({
      where: { employeeId, day, OR: [{ lastAt: null }, { lastAt: { lt: fixedAt } }] },
      data: { lastAt: fixedAt },
    });
  }
  if (!row.firstAt || row.firstAt.getTime() > fixedAt.getTime()) {
    await prisma.locationDay.updateMany({
      where: { employeeId, day, OR: [{ firstAt: null }, { firstAt: { gt: fixedAt } }] },
      data: { firstAt: fixedAt },
    });
  }
}

export type StoredDay = {
  fixes: number;
  warnedAt: Date | null;
  warned2At: Date | null;
  finedAt: Date | null;
  forgivenAt: Date | null;
};

/** These people's rows for one day. Nobody without a row has had a position stored, or a warning. */
export async function locationDaysOn(day: Date, employeeIds: string[]): Promise<Map<string, StoredDay>> {
  if (employeeIds.length === 0) return new Map();
  const rows = await prisma.locationDay.findMany({
    where: { day, employeeId: { in: employeeIds } },
    select: { employeeId: true, fixes: true, warnedAt: true, warned2At: true, finedAt: true, forgivenAt: true },
  });
  return new Map(rows.map(({ employeeId, ...row }) => [employeeId, row]));
}

/** Records that a warning went, once: a second pass at the same minute leaves the first's time. */
export async function stampWarning(employeeId: string, day: Date, warning: 1 | 2, now: Date) {
  await prisma.locationDay.createMany({ data: [{ employeeId, day }], skipDuplicates: true });
  await prisma.locationDay.updateMany({
    where: warning === 1 ? { employeeId, day, warnedAt: null } : { employeeId, day, warned2At: null },
    data: warning === 1 ? { warnedAt: now } : { warned2At: now },
  });
}

/**
 * Charges a day, once. The conditions `finesDue` decided on are repeated in
 * the UPDATE — no position, warned, undecided — so two passes at once charge
 * it once, and a day that changed since it was read is left alone. Answers
 * whether this call was the one that charged it.
 */
export async function claimFine(employeeId: string, day: Date, now: Date): Promise<boolean> {
  const charged = await prisma.locationDay.updateMany({
    where: {
      employeeId,
      day,
      fixes: 0,
      finedAt: null,
      forgivenAt: null,
      OR: [{ warnedAt: { not: null } }, { warned2At: { not: null } }],
    },
    data: { finedAt: now },
  });
  return charged.count > 0;
}

/** Who is charged for this day and not cancelled — whatever pass charged them. */
export async function chargedOn(day: Date): Promise<string[]> {
  const rows = await prisma.locationDay.findMany({
    where: { day, finedAt: { not: null }, forgivenAt: null },
    select: { employeeId: true },
  });
  return rows.map((row) => row.employeeId);
}

/** Which of these people have already been told about this day's charge — the notification's own row. */
export async function toldOfCharge(dayKey: string, employeeIds: string[]): Promise<Set<string>> {
  if (employeeIds.length === 0) return new Set();
  const rows = await prisma.notification.findMany({
    where: { dedupeKey: { in: employeeIds.map((id) => fineKey(id, dayKey)) } },
    select: { employeeId: true },
  });
  return new Set(rows.map((row) => row.employeeId));
}

/** Whether the manager has had this evening's word. */
export async function managerTold(dayKey: string): Promise<boolean> {
  const row = await prisma.adminNotification.findUnique({ where: { dedupeKey: managerFineKey(dayKey) }, select: { id: true } });
  return !!row;
}

/**
 * Sets somebody's month to what its days say: one SalaryAdjustment row of
 * kind LOCATION, a dinar for each charged day that has not been cancelled,
 * with the days named in its reason — and no row at all once that is none.
 *
 * Counted from the days every time, never added to or taken from, so a pass
 * that runs twice or an undo cannot leave the month a dinar out. One count
 * per person and month at a time (a lock held to the end of the
 * transaction): otherwise a charge and an undo landing together could each
 * count what the other had not yet written, and the older count would win.
 */
export async function recountMonth(employeeId: string, periodKey: string) {
  const { start, end } = periodRange(periodKey);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${FINE_KIND}:${employeeId}:${periodKey}`}))`;
    const rows = await tx.locationDay.findMany({
      where: { employeeId, day: { gte: start, lt: end } },
      select: { day: true, finedAt: true, forgivenAt: true },
    });
    const days = finesByMonth(rows.map((row) => ({ ...row, day: dateToDayKey(row.day) as string }))).get(periodKey) ?? [];
    const adjustment = monthAdjustment(days);

    if (!adjustment) {
      await tx.salaryAdjustment.deleteMany({ where: { employeeId, periodKey, kind: FINE_KIND } });
      return;
    }
    await tx.salaryAdjustment.upsert({
      where: { employeeId_periodKey_kind: { employeeId, periodKey, kind: FINE_KIND } },
      create: { employeeId, periodKey, kind: FINE_KIND, ...adjustment },
      update: adjustment,
    });
  });
}

/** Each person's charged days in a month that have not been cancelled, as YYYY-MM-DD, oldest first. */
async function chargedIn(employeeIds: string[], period: string): Promise<Map<string, string[]>> {
  if (employeeIds.length === 0) return new Map();
  const { start, end } = periodRange(period);
  const rows = await prisma.locationDay.findMany({
    where: { employeeId: { in: employeeIds }, day: { gte: start, lt: end }, finedAt: { not: null }, forgivenAt: null },
    select: { employeeId: true, day: true },
    orderBy: { day: "asc" },
  });
  const days = new Map<string, string[]>();
  for (const row of rows) days.set(row.employeeId, [...(days.get(row.employeeId) ?? []), dateToDayKey(row.day) as string]);
  return days;
}

// --- What the phone and the map read ---------------------------------------------------

/** What `me/location` (and `me/location/report`'s answer) carries about the fine. */
export type PhoneFine = { fine: FineRule; sharedToday: boolean; finedThisMonth: string[] };

/**
 * One phone's side of it. `startsOn` is counted from when this person was
 * told, so somebody who joined after the announcement sees their own first
 * day — and null until their notice has gone, because until then no day of
 * theirs counts. A read and nothing else.
 */
export async function phoneFine(employeeId: string, today: FineToday): Promise<PhoneFine> {
  const settings = await fineSettings();
  let startsOn: string | null = null;
  if (settings.on && settings.stamp && settings.announcedAt) {
    const notice = await prisma.notification.findUnique({
      where: { dedupeKey: noticeKey(employeeId, settings.stamp) },
      select: { createdAt: true },
    });
    const announcedAt = toldAt(settings.announcedAt, notice?.createdAt);
    startsOn = fineStartsOn({ hours: today.hours, announcedAt, timeZone: today.timeZone });
  }
  const row = await prisma.locationDay.findUnique({
    where: { employeeId_day: { employeeId, day: today.day } },
    select: { fixes: true },
  });
  const charged = await chargedIn([employeeId], periodOf(today.dayKey));

  return {
    fine: fineRule(settings.on, startsOn),
    sharedToday: (row?.fixes ?? 0) > 0,
    finedThisMonth: charged.get(employeeId) ?? [],
  };
}

/** The map's side: the rule, and for each person whether a position got through today and which days this month cost. A read and nothing else. */
export async function mapFine(employeeIds: string[], today: FineToday) {
  const fine = await ruleNow(today);
  const days = await locationDaysOn(today.day, employeeIds);
  const charged = await chargedIn(employeeIds, periodOf(today.dayKey));
  const people = new Map(
    employeeIds.map((id) => [id, { sharedToday: (days.get(id)?.fixes ?? 0) > 0, finedThisMonth: charged.get(id) ?? [] }])
  );
  return { fine, people };
}

// --- The undo -------------------------------------------------------------------------

/**
 * `team/locations/forgive`: args [employeeId, "YYYY-MM-DD"] → { finedThisMonth }.
 *
 * Cancels a charged day: the day is marked, the month is counted again and
 * the person is told. Cancelling one already cancelled answers the same as
 * the first time — a second tap is not an error — and counts the month again,
 * which also repairs one a first attempt did not finish. A day that was never
 * charged is a sentence, not a row.
 */
export async function forgiveLocationDay(args: unknown[], now: Date = new Date()) {
  const { employeeId, dayKey } = forgiveArgs(args);
  const day = dayKeyToDate(dayKey);
  const row = await prisma.locationDay.findUnique({
    where: { employeeId_day: { employeeId, day } },
    select: { finedAt: true, forgivenAt: true },
  });
  if (!row?.finedAt) {
    throw new RpcError(`Nothing was deducted for location on ${dayName(dayKey)}, so there is nothing to cancel.`, 404);
  }

  const cancelled = row.forgivenAt
    ? 0
    : (
        await prisma.locationDay.updateMany({
          where: { employeeId, day, finedAt: { not: null }, forgivenAt: null },
          data: { forgivenAt: now },
        })
      ).count;
  await recountMonth(employeeId, periodOf(dayKey));

  if (cancelled > 0) {
    await dispatchNotification({
      employeeId,
      type: "LOCATION_REMINDER",
      ...forgivenCopy(dayKey),
      url: DASHBOARD_PATH,
      dedupeKey: forgivenKey(employeeId, dayKey),
    }).catch(() => {
      // The money is put back; a failed push must not undo that.
    });
  }

  const thisMonth = periodOf(dayKeyIn(await getTimezone(), now));
  return { finedThisMonth: (await chargedIn([employeeId], thisMonth)).get(employeeId) ?? [] };
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
