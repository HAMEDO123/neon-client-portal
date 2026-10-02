import { notifyAdmin } from "@/lib/admin-notifications";
import {
  dayEndOf,
  fineCopy,
  fineKey,
  finesDue,
  fineStartsOn,
  managerCopy,
  managerFineKey,
  noticeCopy,
  noticeKey,
  toldAt,
  warningCopy,
  warningKey,
  warningsDue,
  type FineDay,
} from "@/lib/location-fine";
import {
  chargedOn,
  claimAnnouncement,
  claimFine,
  fineSettings,
  managerTold,
  noticesSent,
  recountMonth,
  stampWarning,
  toldOfCharge,
} from "@/lib/location-fine-store";
import { fineCandidates, locationDay } from "@/lib/mobile/location-service";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH } from "@/lib/notifications/types";
import { periodOf } from "@/lib/payroll";
import { isOpen } from "@/lib/staff-location";
import { formatTimeIn } from "@/lib/time";

// The 1 JOD a working day without location, run (lib/location-fine.ts
// decides, lib/location-fine-store.ts keeps).
//
// Called by the location keeper on every pass: every minute from the meeting
// scheduler (`?job=location`), and on every full pass. Two passes can overlap,
// so each of its three jobs is safe to run twice at once:
// - the notice, once per person per announcement and before any day of theirs
//   counts — the first pass with the rule on tells everybody, and a later one
//   tells anybody who has joined the team since;
// - while today's window is open, the day's two warnings, to anybody the
//   device has seen arrive whose phone has not had a position stored yet;
// - from the window's end until midnight, the day's charges, each claimed in
//   its own write; then each person's month is counted again and they are
//   told, and the manager is told once, with everybody's names.
//
// Arrivals and departures are read as the device sync stored them; the device
// itself is never asked from here.

const PAYROLL_PATH = "/admin/payroll";

type Today = Awaited<ReturnType<typeof locationDay>>;

export async function runLocationFines(now: Date = new Date(), given?: Today) {
  const settings = await fineSettings();
  if (!settings.on) return { on: false as const };

  const today = given ?? (await locationDay(now));
  const stamp = settings.stamp ?? (await claimAnnouncement(now));
  const announcedAt = new Date(stamp);
  const candidates = await fineCandidates(today.day);
  const told = await noticesSent(stamp, candidates.map((person) => person.id));

  // The notice. Whoever is told now has no day counted until the next window
  // starts, which is what the message says.
  let announced = 0;
  const startsOn = fineStartsOn({ hours: today.hours, announcedAt: toldAt(announcedAt, now), timeZone: today.timeZone });
  for (const person of candidates) {
    if (told.has(person.id)) continue;
    const result = await dispatchNotification({
      employeeId: person.id,
      type: "LOCATION_REMINDER",
      ...noticeCopy(startsOn),
      url: DASHBOARD_PATH,
      dedupeKey: noticeKey(person.id, stamp),
    }).catch(() => null);
    if (result?.created || result?.skipped === "duplicate") told.set(person.id, now);
    if (result?.created) announced++;
  }

  const people: FineDay[] = candidates.map((person) => ({ ...person, announcedAt: toldAt(announcedAt, told.get(person.id)) }));
  const warned = isOpen(today.window, now) ? await sendWarnings(now, today, people) : 0;

  let fined = 0;
  const dayEnd = dayEndOf(today.dayKey, today.timeZone);
  if (today.window && now.getTime() >= today.window.end.getTime() && now.getTime() < dayEnd.getTime()) {
    for (const employeeId of finesDue({ now, window: today.window, people, dayEnd })) {
      if (await claimFine(employeeId, today.day, now)) fined++;
    }
    await settleCharges(today, candidates);
  }

  return { on: true as const, announced, warned, fined };
}

/** The day's warnings that are due, each once. Answers how many went. */
async function sendWarnings(now: Date, today: Today, people: FineDay[]): Promise<number> {
  if (!today.window) return 0;
  const times = {
    startsAt: formatTimeIn(today.timeZone, today.window.start) ?? today.hours.start,
    endsAt: formatTimeIn(today.timeZone, today.window.end) ?? today.hours.end,
  };

  let sent = 0;
  for (const item of warningsDue({ now, window: today.window, people })) {
    const result = await dispatchNotification({
      employeeId: item.employeeId,
      type: "LOCATION_REMINDER",
      ...warningCopy(item.warning, times),
      url: DASHBOARD_PATH,
      dedupeKey: warningKey(item.warning, item.employeeId, today.dayKey),
    }).catch(() => null);
    // Stamped only once the warning is in the person's alerts: a day is
    // charged only if it was warned, so a warning that was never written must
    // not count as one. The next pass tries again.
    if (result?.created || result?.skipped === "duplicate") {
      await stampWarning(item.employeeId, today.day, item.warning, now);
      if (result.created) sent++;
    }
  }
  return sent;
}

/**
 * Everybody charged today and not yet told: their month counted again, then
 * the message — so being told is the mark that the month is right, and a
 * pass that stopped between the two is finished by the next one. Then the
 * manager, once, with every name.
 */
async function settleCharges(today: Today, team: { id: string; name: string }[]) {
  const charged = new Set(await chargedOn(today.day));
  const people = team.filter((person) => charged.has(person.id)).sort((a, b) => a.name.localeCompare(b.name));
  if (people.length === 0) return;

  const told = await toldOfCharge(today.dayKey, people.map((person) => person.id));
  for (const person of people) {
    if (told.has(person.id)) continue;
    await recountMonth(person.id, periodOf(today.dayKey));
    await dispatchNotification({
      employeeId: person.id,
      type: "LOCATION_REMINDER",
      ...fineCopy(today.dayKey),
      url: DASHBOARD_PATH,
      dedupeKey: fineKey(person.id, today.dayKey),
    }).catch(() => {
      // The month is counted; a failed push must not undo that.
    });
  }

  if (!(await managerTold(today.dayKey))) {
    await notifyAdmin({
      type: "LOCATION",
      ...managerCopy(people.map((person) => person.name), today.dayKey),
      url: PAYROLL_PATH,
      dedupeKey: managerFineKey(today.dayKey),
      employeeId: people.length === 1 ? people[0].id : null,
    });
  }
}
