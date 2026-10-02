import { prisma } from "@/lib/db";
import { bool } from "@/lib/mobile/rpc";
import { getSetting, getTimezone, getWorkHours, setSetting } from "@/lib/settings";
import { dayKeyIn, dayKeyToDate } from "@/lib/time";
import type { WorkHours } from "@/lib/work-hours";
import { deviceOutcome, isApnsConfigured, sendBackground, type ApnsResult } from "@/lib/notifications/apns";
import { countFix, locationDaysOn, mapFine, phoneFine, type PhoneFine } from "@/lib/location-fine-store";
import type { FineDay } from "@/lib/location-fine";
import {
  byStateThenName,
  insideWindow,
  isOpen,
  LOCATION_WAKE,
  locationWindow,
  nextWindowStart,
  officeFromArgs,
  parseReport,
  personRow,
  readOffice,
  readRequired,
  REFRESH_MINUTES,
  REQUIRED_KEY,
  sharePlan,
  whoToPing,
  type LocationWindow,
  type Permission,
  type PingCandidate,
  type Place,
  type SharePlan,
} from "@/lib/staff-location";

// Where the team is, read and written. The rules are lib/staff-location.ts;
// this only fetches what they need and stores what they allow.
//
// Reached three ways, each behind its own guard: the phone's own plan, its
// reports and its permission (registry/me.ts, requireEmployee — the session
// says whose, never an argument); the manager's map, its Refresh and the
// office (registry/team.ts, requireAdmin); and the scheduler's keeper
// (lib/notifications/location-keeper.ts).
//
// The 1 JOD a working day without location rides on the same reads and
// reports (lib/location-fine.ts decides, lib/location-fine-store.ts keeps):
// a kept position is counted on that day's LocationDay, and the plan and the
// map say whether today's got through and which days this month cost.
//
// Not "use server": every export of one of those is callable over the network.

/**
 * The people the map is about: the team, as the team count on `team/employees`
 * counts it. Never the manager's own row (accessRole MANAGER), never somebody
 * disabled.
 */
const TRACKED = { active: true, accessRole: "EMPLOYEE" } as const;

export const OFFICE_KEY = "office_location";

/** Today as the map sees it: the studio's window, when the next one opens, and what they were worked out from. */
export async function locationDay(now: Date = new Date()): Promise<{
  dayKey: string;
  day: Date;
  timeZone: string;
  hours: WorkHours;
  window: LocationWindow | null;
  nextStartsAt: Date | null;
}> {
  const timeZone = await getTimezone();
  const hours = await getWorkHours();
  const dayKey = dayKeyIn(timeZone, now);
  return {
    dayKey,
    day: dayKeyToDate(dayKey),
    timeZone,
    hours,
    window: locationWindow(hours, dayKey, timeZone),
    nextStartsAt: nextWindowStart(hours, now, timeZone),
  };
}

/**
 * What the fingerprint device has written for these people today, as the
 * sync stored it. Nothing here reads the device: the clock reminders and the
 * ten-minute pass keep the rows fresh, and a phone's plan is not worth a
 * conversation with a machine that takes one caller at a time.
 */
async function attendanceOn(day: Date, employeeIds: string[]) {
  const records = await prisma.attendanceRecord.findMany({
    where: { day, employeeId: { in: employeeIds } },
    select: { employeeId: true, arrivedAt: true, departedAt: true },
  });
  return new Map(records.map((record) => [record.employeeId, record]));
}

async function planNow(employeeId: string, now: Date) {
  const today = await locationDay(now);
  const attendance = await attendanceOn(today.day, [employeeId]);
  const plan = sharePlan({
    now,
    window: today.window,
    nextStartsAt: today.nextStartsAt,
    departedAt: attendance.get(employeeId)?.departedAt ?? null,
  });
  return { today, plan };
}

// --- The phone's side ------------------------------------------------------------

/**
 * A plan as the phone receives it: with whether the studio requires location
 * at all, and the 1 JOD a day without it — the rule, whether a position got
 * through today, and which days this month cost.
 */
export type PhonePlan = SharePlan & { required: boolean } & PhoneFine;

/** Whether everybody on the team must allow their location to use the app (AppSetting `location_required`). */
export async function locationRequired(): Promise<boolean> {
  return readRequired(await getSetting(REQUIRED_KEY));
}

/** `me/location`: whether this phone should be sharing now, and when that changes. A read and nothing else. */
export async function locationPlanFor(employeeId: string, now: Date = new Date()): Promise<PhonePlan> {
  const { today, plan } = await planNow(employeeId, now);
  return { ...plan, required: await locationRequired(), ...(await phoneFine(employeeId, today)) };
}

/** `team/locations/required`: args [true | false] → { required }. */
export async function setLocationRequired(args: unknown[]) {
  const required = bool(args[0]);
  await setSetting(REQUIRED_KEY, required ? "true" : "false");
  return { required };
}

/**
 * `me/location/report`: keeps the position when the plan says sharing and the
 * fix was taken inside the window, and answers with the plan either way — the
 * answer is what stops a phone that is still sending after hours.
 */
export async function reportLocation(employeeId: string, args: unknown[], now: Date = new Date()): Promise<PhonePlan> {
  const { today, plan: shared } = await planNow(employeeId, now);
  const required = await locationRequired();
  // Read last, so the answer to the day's first position already says it got through.
  const answer = async (): Promise<PhonePlan> => ({ ...shared, required, ...(await phoneFine(employeeId, today)) });
  // Not sharing: nothing in the request is even read, because there is
  // nothing it could be kept as.
  if (!shared.sharing) return answer();

  const report = parseReport(args, now);
  // A fix from 10:58 sent at 11:01 says where somebody was before the day
  // began, which is not the map's to know.
  if (!insideWindow(report.fixedAt, today.window)) return answer();

  const position = {
    latitude: report.latitude,
    longitude: report.longitude,
    accuracy: report.accuracy,
    fixedAt: report.fixedAt,
    precise: report.precise,
  };
  // Only the latest is kept, and the latest is when the phone took it: a
  // report held up on a slow connection must not replace a newer one that
  // overtook it. The condition is in the UPDATE itself so two arriving at once
  // cannot get it wrong between a read and a write.
  const moved = await prisma.staffLocation.updateMany({
    where: { employeeId, OR: [{ fixedAt: null }, { fixedAt: { lt: report.fixedAt } }] },
    data: position,
  });
  let kept = moved.count > 0;
  if (!kept) {
    // No row yet — or a newer fix already in it, which this leaves alone.
    const made = await prisma.staffLocation.createMany({ data: [{ employeeId, ...position }], skipDuplicates: true });
    kept = made.count > 0;
  }

  // Counted only once kept: today's count is what the 1 JOD a day without
  // location is decided on, and one position is all a day needs.
  if (kept) await countFix(employeeId, today.day, report.fixedAt);

  return answer();
}

/** `me/location/permission`: the phone's switch, at any hour — a setting, not a position. */
export async function setLocationPermission(employeeId: string, permission: Permission, precise: boolean) {
  await prisma.staffLocation.upsert({
    where: { employeeId },
    create: { employeeId, permission, precise },
    update: { permission, precise },
  });
  return { ok: true };
}

// --- The manager's side ----------------------------------------------------------

/**
 * `team/locations`: everybody on the team, as the map shows them. A read and
 * nothing else — it changes no row and wakes no phone, which is what lets the
 * app's screenshot runs (GETs only) draw it. What may be shown is decided by
 * `personRow`, so a position the keeper has not yet wiped is still not shown.
 */
export async function teamLocations(now: Date = new Date()) {
  const today = await locationDay(now);
  const office = await officeLocation();
  const people = await prisma.employee.findMany({
    where: TRACKED,
    select: { id: true, name: true, role: true, photoUrl: true, staffLocation: true },
  });
  const attendance = await attendanceOn(today.day, people.map((person) => person.id));
  const fine = await mapFine(people.map((person) => person.id), today);

  const rows = people.map((person) => ({
    ...personRow({
      person: { id: person.id, name: person.name, photoUrl: person.photoUrl, role: person.role },
      stored: person.staffLocation,
      attendance: attendance.get(person.id) ?? null,
      now,
      window: today.window,
      office,
    }),
    // Not a position: whether one got through today at all, and which days
    // this month cost 1 JOD for want of one.
    ...(fine.people.get(person.id) ?? { sharedToday: false, finedThisMonth: [] }),
  }));
  rows.sort(byStateThenName);

  return {
    open: isOpen(today.window, now),
    required: await locationRequired(),
    fine: fine.fine,
    startsAt: today.window?.start ?? null,
    endsAt: today.window?.end ?? null,
    nextStartsAt: today.nextStartsAt,
    office,
    people: rows,
  };
}

/** `team/locations/refresh`: wakes the phones that have gone quiet for two minutes → { asked }. */
export async function refreshTeamLocations(now: Date = new Date()) {
  const today = await locationDay(now);
  if (!isOpen(today.window, now)) return { asked: 0 };

  const due = whoToPing({ now, window: today.window, people: await pingCandidates(today.day), quietMinutes: REFRESH_MINUTES });
  return { asked: await wakePhones(due, now) };
}

/** Where the office is, or null until the manager sets it. */
export async function officeLocation(): Promise<Place | null> {
  return readOffice(await getSetting(OFFICE_KEY));
}

/** `team/locations/office`: args [latitude, longitude] sets it, [] or [null] clears it → { office }. */
export async function setOfficeLocation(args: unknown[]) {
  const office = officeFromArgs(args);
  // Cleared is stored as JSON null rather than deleted: one shape, read one way.
  await setSetting(OFFICE_KEY, JSON.stringify(office));
  return { office };
}

// --- Waking phones and wiping positions (the Refresh, and the keeper) ---------------

/** Everybody tracked, with what `whoToPing` decides on. */
export async function pingCandidates(day: Date): Promise<PingCandidate[]> {
  const people = await prisma.employee.findMany({
    where: TRACKED,
    select: { id: true, staffLocation: { select: { permission: true, fixedAt: true, pingedAt: true } } },
  });
  const attendance = await attendanceOn(day, people.map((person) => person.id));

  return people.map((person) => ({
    id: person.id,
    permission: person.staffLocation?.permission ?? "unknown",
    fixedAt: person.staffLocation?.fixedAt ?? null,
    pingedAt: person.staffLocation?.pingedAt ?? null,
    departedAt: attendance.get(person.id)?.departedAt ?? null,
  }));
}

/**
 * Asks these people's phones for a fresh position with a silent push.
 * Answers how many people had at least one phone take it.
 *
 * The app's ordinary notification tokens: a silent push goes to the same token
 * and topic as an alert, and a VoIP token is for ringing and nothing else.
 * Tracked people only, whatever the caller passed — the manager's phone is
 * never woken.
 */
export async function wakePhones(employeeIds: string[], now: Date = new Date()): Promise<number> {
  if (employeeIds.length === 0 || !isApnsConfigured()) return 0;

  const devices = await prisma.deviceToken.findMany({
    where: { employeeId: { in: employeeIds }, active: true, kind: "ALERT", employee: TRACKED },
  });
  if (devices.length === 0) return 0;

  const phones = new Map<string, typeof devices>();
  for (const device of devices) phones.set(device.employeeId, [...(phones.get(device.employeeId) ?? []), device]);

  // Stamped first, so a phone that never answers is not asked again until
  // its turn comes round, whatever became of this push.
  const asked = [...phones.keys()];
  await prisma.staffLocation.updateMany({ where: { employeeId: { in: asked } }, data: { pingedAt: now } });
  await prisma.staffLocation.createMany({
    data: asked.map((employeeId) => ({ employeeId, pingedAt: now })),
    skipDuplicates: true,
  });

  let woken = 0;
  await Promise.all(
    [...phones.values()].map(async (list) => {
      let reached = false;
      for (const device of list) {
        const result = await sendBackground(
          { token: device.token, bundleId: device.bundleId, sandbox: device.sandbox },
          LOCATION_WAKE
        );
        if (result.ok) reached = true;
        await keepDevice(device, result);
      }
      if (reached) woken++;
    })
  );
  return woken;
}

/**
 * What a wake-up's answer means for the token. Success, and Apple saying the
 * token is gone, are acted on exactly as an alert's are (`deviceOutcome`):
 * both are facts about the token, whatever was sent to it. Any other failure
 * is logged and not counted towards the ten that retire a token — a phone is
 * woken dozens of times a day, so counting them would let an hour without
 * internet switch somebody's ordinary notifications off for good.
 */
async function keepDevice(
  device: { id: string; failureCount: number; lastUsedAt: Date | null },
  result: ApnsResult
) {
  if (!result.ok) {
    // The one place a refused wake-up shows: docker logs neon-app.
    console.warn(`[location] ${device.id}: ${result.statusCode ?? "no status"} ${result.error}`);
    if (!result.gone) return;
  }
  const outcome = deviceOutcome(result, device.failureCount);
  await prisma.deviceToken
    .update({
      where: { id: device.id },
      data: {
        active: outcome.active,
        failureCount: outcome.failureCount,
        lastUsedAt: result.ok ? new Date() : device.lastUsedAt,
      },
    })
    .catch(() => undefined);
}

/**
 * Takes the coordinates off these rows (everybody's, with no list), keeping
 * what describes the phone — its permission, precise, when it was last asked.
 * Answers how many rows held a position.
 */
export async function wipePositions(employeeIds?: string[]): Promise<number> {
  if (employeeIds && employeeIds.length === 0) return 0;
  const result = await prisma.staffLocation.updateMany({
    where: {
      ...(employeeIds ? { employeeId: { in: employeeIds } } : {}),
      OR: [
        { latitude: { not: null } },
        { longitude: { not: null } },
        { accuracy: { not: null } },
        { fixedAt: { not: null } },
      ],
    },
    data: { latitude: null, longitude: null, accuracy: null, fixedAt: null },
  });
  return result.count;
}

// --- The 1 JOD a day without location (the keeper) ------------------------------------

/**
 * Everybody tracked, with what the 1 JOD a day without location is decided on
 * (`warningsDue`, `finesDue` in lib/location-fine.ts): the device's arrival
 * and departure today, as the sync stored them, and today's LocationDay. When
 * each was told about the rule is the caller's to add.
 */
export async function fineCandidates(day: Date): Promise<(Omit<FineDay, "announcedAt"> & { name: string })[]> {
  const people = await prisma.employee.findMany({ where: TRACKED, select: { id: true, name: true } });
  const ids = people.map((person) => person.id);
  const attendance = await attendanceOn(day, ids);
  const days = await locationDaysOn(day, ids);

  return people.map((person) => {
    const stored = days.get(person.id);
    return {
      id: person.id,
      name: person.name,
      arrivedAt: attendance.get(person.id)?.arrivedAt ?? null,
      departedAt: attendance.get(person.id)?.departedAt ?? null,
      fixes: stored?.fixes ?? 0,
      warnedAt: stored?.warnedAt ?? null,
      warned2At: stored?.warned2At ?? null,
      finedAt: stored?.finedAt ?? null,
      forgivenAt: stored?.forgivenAt ?? null,
    };
  });
}
