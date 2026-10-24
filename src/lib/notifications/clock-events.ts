import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/admin-notifications";
import { syncAttendanceIfStale } from "@/lib/attendance-sync";
import {
  anyWindowOpen,
  clockWindows,
  dueClockReminders,
  endForPerson,
  type ClockKind,
  type ClockSent,
} from "@/lib/clock-reminders";
import { awayMinutesOf, storedBreaks } from "@/lib/attendance-breaks";
import { dispatchNotification, repeatPush } from "@/lib/notifications/engine";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { dayKeyIn, dayKeyToDate, formatTimeIn } from "@/lib/time";

// "Clock in" and "Clock out", sent (lib/clock-reminders.ts decides when).
//
// Called every minute by the meeting scheduler (`?job=clock`) and on every
// full pass. Outside the windows it returns at once without touching the
// device. Inside them it reads the device first — at most once a minute — and
// **says nothing at all if the device could not be read recently**: telling
// somebody to clock in a minute after they did, because the punch never
// reached the server, is the one way this could be wrong out loud.

const FRESH_SECONDS = 60;
const TOO_OLD_SECONDS = 4 * 60;

export async function runClockReminders(now = new Date()) {
  const timeZone = await getTimezone();
  const hours = await getWorkHours();
  const dayKey = dayKeyIn(timeZone, now);
  const windows = clockWindows(hours, dayKey, timeZone);
  if (!windows) return { skipped: "not a working day" };
  // Who clocks in on the device: the team, paired to a fingerprint. The
  // manager's own row and anybody not paired are never chased — the device
  // could never see them.
  const people = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE", deviceUserId: { not: null } },
    select: { id: true, name: true },
  });
  if (people.length === 0) return { skipped: "nobody is paired to the device" };

  const day = dayKeyToDate(dayKey);
  const ids = people.map((p) => p.id);

  /** When somebody is owed until, from what is on their row. */
  const endsFor = (arrivedAt: Date | null, breaks: unknown) =>
    endForPerson(hours, dayKey, timeZone, arrivedAt, awayMinutesOf(storedBreaks(breaks)));

  // Read before deciding whether to look at all. The out side belongs to each
  // person now: somebody who started at 2 PM is owed until 10, and a gate on
  // the studio's own 7 PM would have closed hours before they finish. One row
  // each, so it costs nothing to ask first.
  const sofar = await prisma.attendanceRecord.findMany({
    where: { day, employeeId: { in: ids } },
    select: { arrivedAt: true, breaks: true },
  });
  const ends = sofar.map((row) => endsFor(row.arrivedAt, row.breaks));

  if (!anyWindowOpen(windows, now, ends)) return { skipped: "outside the clock windows" };

  const lastRead = await syncAttendanceIfStale(FRESH_SECONDS, now);
  if (!lastRead || (now.getTime() - lastRead.getTime()) / 1000 > TOO_OLD_SECONDS) {
    return { skipped: "the device could not be read — nothing said" };
  }

  // Read again, after the sync: whether somebody has just clocked out is the
  // whole question, and the rows above were taken before the device was asked.
  // One after the other, as the rest of this codebase reads.
  const records = await prisma.attendanceRecord.findMany({
    where: { day, employeeId: { in: ids } },
    select: { employeeId: true, arrivedAt: true, departedAt: true, breaks: true },
  });
  const sentRows = await prisma.clockReminder.findMany({ where: { day, employeeId: { in: ids } } });
  const byPerson = new Map(records.map((r) => [r.employeeId, r]));
  const sent = new Map<string, ClockSent[]>();
  for (const row of sentRows) {
    const list = sent.get(row.employeeId) ?? [];
    list.push({ kind: row.kind as ClockKind, lastAt: row.lastAt });
    sent.set(row.employeeId, list);
  }

  const due = dueClockReminders({
    now,
    windows,
    people: people.map((p) => {
      const row = byPerson.get(p.id);
      return {
        id: p.id,
        arrivedAt: row?.arrivedAt ?? null,
        departedAt: row?.departedAt ?? null,
        endsAt: endsFor(row?.arrivedAt ?? null, row?.breaks),
      };
    }),
    sent,
  });

  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  const startText = formatTimeIn(timeZone, windows.start) ?? hours.start;
  const endText = formatTimeIn(timeZone, windows.end) ?? hours.end;
  const nowText = formatTimeIn(timeZone, now) ?? "";
  let sentCount = 0;

  for (const item of due) {
    const name = nameOf.get(item.employeeId) ?? "";
    // Their own end: telling somebody who finishes at 10 that "the day ends at
    // 7:00 PM" contradicts the message they were sent when they arrived.
    const mine = byPerson.get(item.employeeId);
    const myEnd = endsFor(mine?.arrivedAt ?? null, mine?.breaks) ?? windows.end;
    const myEndText = formatTimeIn(timeZone, myEnd) ?? endText;
    const existing = sentRows.find((r) => r.employeeId === item.employeeId && r.kind === item.kind);

    if (item.kind === "in-missed" || item.kind === "out-missed") {
      // Said as what the device saw — never that somebody was absent or left
      // without saying: the device cannot tell those apart from a missed punch.
      await notifyAdmin({
        type: "ATTENDANCE",
        title: item.kind === "in-missed" ? `${name} hasn't clocked in` : `${name} hasn't clocked out`,
        message:
          item.kind === "in-missed"
            ? `The fingerprint hasn't seen them since the day started at ${startText}, after an hour of reminders.`
            : `They clocked in today, and the fingerprint hasn't seen them leave since ${myEndText}, after an hour of reminders.`,
        url: "/admin/attendance",
        dedupeKey: `CLOCK:${item.kind}:${item.employeeId}:${dayKey}`,
        employeeId: item.employeeId,
      });
      await record(item.employeeId, day, item.kind, null, now);
      sentCount++;
      continue;
    }

    const copy =
      item.kind === "in"
        ? {
            title: "Clock in",
            message: existing
              ? `It's ${nowText} and the fingerprint still hasn't seen you. Clock in now.`
              : `The day started at ${startText}. Clock in on the fingerprint.`,
          }
        : item.kind === "out-soon"
          ? { title: "Clock out in 10 minutes", message: `Your day ends at ${myEndText}. Remember to clock out on the fingerprint before you leave.` }
          : {
              title: "Clock out",
              message: existing
                ? `It's ${nowText} and you haven't clocked out yet. Clock out on the fingerprint.`
                : `Your day ended at ${myEndText}. Clock out on the fingerprint.`,
            };

    if (existing?.notificationId) {
      await repeatPush(existing.notificationId, copy).catch(() => undefined);
      await record(item.employeeId, day, item.kind, existing.notificationId, now);
    } else {
      const result = await dispatchNotification({
        employeeId: item.employeeId,
        type: "ATTENDANCE_REMINDER",
        title: copy.title,
        message: copy.message,
        url: "/employee",
        dedupeKey: `CLOCK:${item.kind}:${item.employeeId}:${dayKey}`,
      }).catch(() => null);
      await record(item.employeeId, day, item.kind, result?.notificationId ?? null, now);
    }
    sentCount++;
  }

  return { sent: sentCount, due: due.map((d) => d.kind), deviceReadAt: lastRead.toISOString() };
}

async function record(employeeId: string, day: Date, kind: ClockKind, notificationId: string | null, now: Date) {
  await prisma.clockReminder.upsert({
    where: { employeeId_day_kind: { employeeId, day, kind } },
    create: { employeeId, day, kind, count: 1, notificationId, firstAt: now, lastAt: now },
    update: { count: { increment: 1 }, lastAt: now, ...(notificationId ? { notificationId } : {}) },
  });
}
