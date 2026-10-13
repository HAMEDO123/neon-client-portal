import { notifyAdmin } from "@/lib/admin-notifications";
import { prisma } from "@/lib/db";
import { chargeLateTask } from "@/lib/deduction-store";
import { dispatchNotification } from "@/lib/notifications/engine";
import { getSetting, getTimezone, getWorkHours, setSetting } from "@/lib/settings";
import {
  CUTOFF_ANNOUNCED,
  CUTOFF_HOUR,
  CUTOFF_SETTING,
  chargeCopy,
  chargeKey,
  chargeable,
  cutoffOn,
  cutoffPhase,
  dayCounts,
  handedIn,
  managerCopy,
  managerKey,
  noticeCopy,
  noticeKey,
  warningCopy,
  warningKey,
} from "@/lib/task-cutoff";
import { dayKeyIn, dayKeyToDate, hourIn, instantAt } from "@/lib/time";
import { isWorkingDay } from "@/lib/work-hours";

// The nine o'clock rule, run on every scheduler pass (lib/task-cutoff.ts has
// the rule itself, and why each safeguard is there). Safe to run as often as
// it likes: the notice, the warning and each charge are keyed, so a pass that
// runs twice says and charges each thing once.

export async function runTaskCutoffs(now = new Date()) {
  if (!cutoffOn(await getSetting(CUTOFF_SETTING))) return { on: false as const };

  const timeZone = await getTimezone();
  const dayKey = dayKeyIn(timeZone, now);

  const team = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    select: { id: true, name: true, salaryAmount: true, payBasis: true },
  });

  // The notice first, and to anybody who has joined since it went out.
  let stamp = await getSetting(CUTOFF_ANNOUNCED);
  if (!stamp) {
    stamp = now.toISOString();
    await setSetting(CUTOFF_ANNOUNCED, stamp);
  }
  let announced = 0;
  for (const person of team) {
    const result = await dispatchNotification({
      employeeId: person.id,
      type: "WARNING",
      ...noticeCopy(),
      url: "/employee/tasks",
      dedupeKey: noticeKey(person.id, stamp),
    }).catch(() => null);
    if (result?.created) announced++;
  }

  const hours = await getWorkHours();
  const announcedDay = dayKeyIn(timeZone, new Date(stamp));
  if (!isWorkingDay(hours, dayKey) || !dayCounts(dayKey, announcedDay)) {
    return { on: true as const, announced, warned: 0, charged: 0 };
  }

  const phase = cutoffPhase(hourIn(timeZone, now));
  if (phase === "before") return { on: true as const, announced, warned: 0, charged: 0 };

  // Every job due today, with who it belongs to.
  const due = await prisma.assignedTask.findMany({
    where: { endDay: dayKeyToDate(dayKey), employeeId: { in: team.map((person) => person.id) } },
    select: { id: true, title: true, state: true, createdAt: true, siteVisitId: true, employeeId: true },
  });
  const cutoffAt = instantAt(dayKey, `${CUTOFF_HOUR}:00`, timeZone) ?? now;
  const out = due.filter((task) => chargeable(task, cutoffAt));

  if (phase === "warn") {
    let warned = 0;
    for (const person of team) {
      const count = out.filter((task) => task.employeeId === person.id).length;
      if (count === 0) continue;
      const result = await dispatchNotification({
        employeeId: person.id,
        type: "WARNING",
        ...warningCopy(count),
        url: "/employee/tasks?filter=open",
        dedupeKey: warningKey(person.id, dayKey),
      }).catch(() => null);
      if (result?.created) warned++;
    }
    return { on: true as const, announced, warned, charged: 0 };
  }

  // Past nine. Only people who were warned this evening: an evening the server
  // could not warn is an evening it could not have taken the work in either.
  const warnedRows = await prisma.notification.findMany({
    where: { dedupeKey: { in: team.map((person) => warningKey(person.id, dayKey)) } },
    select: { employeeId: true },
  });
  const warnedIds = new Set(warnedRows.map((row) => row.employeeId));

  let charged = 0;
  const summary: { name: string; count: number }[] = [];
  for (const person of team) {
    if (!warnedIds.has(person.id)) continue;
    const mine = out.filter((task) => task.employeeId === person.id);
    if (mine.length === 0) continue;

    let fresh = 0;
    for (const task of mine) {
      if (await chargeLateTask(task, person, dayKey)) fresh++;
    }
    charged += fresh;

    // Told from what stands charged for today, not from this pass's count, so
    // a pass that stopped between charging and telling is finished by the next.
    const today = await prisma.deduction.findMany({
      where: { employeeId: person.id, kind: "TASK", day: dayKeyToDate(dayKey), cancelledAt: null },
      select: { amount: true },
    });
    if (today.length === 0) continue;
    summary.push({ name: person.name, count: today.length });
    await dispatchNotification({
      employeeId: person.id,
      type: "WARNING",
      ...chargeCopy(today.length, today.reduce((sum, row) => sum + row.amount, 0)),
      url: "/employee/tasks?filter=late",
      dedupeKey: chargeKey(person.id, dayKey),
    }).catch(() => undefined);
  }

  if (summary.length > 0) {
    await notifyAdmin({
      type: "TASK_OVERDUE",
      ...managerCopy(summary),
      url: "/admin/payroll",
      dedupeKey: managerKey(dayKey),
    });
  }

  return { on: true as const, announced, warned: 0, charged };
}

/** For a screen: whether the rule is on, and how many of today's jobs are still out. */
export async function taskCutoffState() {
  const on = cutoffOn(await getSetting(CUTOFF_SETTING));
  const timeZone = await getTimezone();
  const dayKey = dayKeyIn(timeZone, new Date());
  const due = await prisma.assignedTask.findMany({
    where: { endDay: dayKeyToDate(dayKey) },
    select: { state: true },
  });
  return { on, stillOut: due.filter((task) => !handedIn(task.state)).length };
}
