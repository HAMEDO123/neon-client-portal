import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { allTasks, ownedBy, taskForEmployee } from "@/lib/employee-tasks";
import { getDailyProgress, getEmployeeProgress } from "@/lib/analytics-queries";
import { dispatchNotification } from "@/lib/notifications/engine";
import { notifyTaskAssigned, notifyTaskUpdated, runScheduleNotifier } from "@/lib/notifications/events";
import { snapshotOf } from "@/lib/notifications/events";
import { assignedKey } from "@/lib/notifications/types";
import { periodOf } from "@/lib/payroll";
import { getTimezone } from "@/lib/settings";
import { dayKeyToDate, todayKey, tomorrowKey } from "@/lib/time";

// Integration tests against a real database — these are the guarantees that
// cannot be proven with pure functions: that one employee's id genuinely
// cannot reach another's rows, and that the daily job is idempotent through
// the unique index rather than only in theory.
//
// Run with: npm run test:db   (needs the local dev database up)
//
// The npm script passes --env-file so DATABASE_URL is set before any import
// runs: ESM hoists imports, so loading dotenv inside this file would happen
// after the Prisma client had already been constructed.

const PREFIX = "ztest-";
const startedAt = new Date();

let reachable = false;
let alice = "";
let bob = "";
let disabled = "";
let projectId = "";
let aliceEntryId = "";
let bobEntryId = "";

async function cleanup() {
  // Remove only what these tests created, including any notification raised
  // for a real employee while the schedule job was exercised.
  await prisma.notification.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.notificationDelivery.deleteMany({ where: { createdAt: { gte: startedAt } } });
  await prisma.projectTaskEntry.deleteMany({ where: { task: { name: { startsWith: PREFIX } } } });
  await prisma.processTask.deleteMany({ where: { name: { startsWith: PREFIX } } });
  // Section holders go with their section.
  await prisma.processSection.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.pushSubscription.deleteMany({ where: { endpoint: { startsWith: `https://push.example/${PREFIX}` } } });
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
  await prisma.project.deleteMany({ where: { name: { startsWith: PREFIX } } });
}

before(async () => {
  try {
    await prisma.$queryRaw`select 1`;
    reachable = true;
  } catch {
    reachable = false;
    return;
  }

  await cleanup();

  const [a, b, d] = await Promise.all([
    prisma.employee.create({
      data: { name: `${PREFIX}Alice`, email: `${PREFIX}alice@test.local`, active: true, accessRole: "EMPLOYEE" },
    }),
    prisma.employee.create({
      data: { name: `${PREFIX}Bob`, email: `${PREFIX}bob@test.local`, active: true, accessRole: "EMPLOYEE" },
    }),
    prisma.employee.create({ data: { name: `${PREFIX}Dana`, email: `${PREFIX}dana@test.local`, active: false } }),
  ]);
  alice = a.id;
  bob = b.id;
  disabled = d.id;

  const project = await prisma.project.create({
    data: { name: `${PREFIX}Project`, token: `${PREFIX}${Date.now()}`, clientName: "Test Client" },
  });
  projectId = project.id;

  const [aliceStep, bobStep] = await Promise.all([
    prisma.processTask.create({ data: { name: `${PREFIX}Alice step`, employeeId: alice, order: 900 } }),
    prisma.processTask.create({ data: { name: `${PREFIX}Bob step`, employeeId: bob, order: 901 } }),
  ]);

  const timezone = await getTimezone();
  const [aliceEntry, bobEntry] = await Promise.all([
    prisma.projectTaskEntry.create({
      data: { projectId, taskId: aliceStep.id, scheduledFor: dayKeyToDate(tomorrowKey(timezone)) },
    }),
    prisma.projectTaskEntry.create({ data: { projectId, taskId: bobStep.id } }),
  ]);
  aliceEntryId = aliceEntry.id;
  bobEntryId = bobEntry.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

describe("employee data isolation", () => {
  it("returns a task to its owner", async (t) => {
    if (!reachable) return t.skip("no database");
    const task = await taskForEmployee(alice, aliceEntryId);
    assert.ok(task, "Alice should see her own task");
  });

  it("refuses another employee's task id", async (t) => {
    if (!reachable) return t.skip("no database");
    // Bob asking for Alice's task by id gets nothing — the ownership rule is
    // in the query, so there is no row to leak.
    assert.equal(await taskForEmployee(bob, aliceEntryId), null);
    assert.equal(await taskForEmployee(alice, bobEntryId), null);
  });

  it("lists only the employee's own tasks", async (t) => {
    if (!reachable) return t.skip("no database");
    const mine = await allTasks(alice);
    assert.ok(mine.every((task) => task.id !== bobEntryId));
    assert.ok(mine.some((task) => task.id === aliceEntryId));
  });

  it("scopes notifications by employee", async (t) => {
    if (!reachable) return t.skip("no database");
    await dispatchNotification({
      employeeId: alice,
      type: "SYSTEM_NOTIFICATION",
      title: "For Alice",
      message: "Alice only",
      url: "/employee",
      dedupeKey: `${PREFIX}alice-only`,
    });

    const bobsView = await prisma.notification.findMany({ where: { employeeId: bob } });
    assert.equal(bobsView.some((n) => n.title === "For Alice"), false);
  });

  it("keeps the ownership rule in the where clause", async (t) => {
    if (!reachable) return t.skip("no database");
    // Belt and braces: the raw filter used everywhere must never match a row
    // owned by someone else.
    const rows = await prisma.projectTaskEntry.findMany({ where: await ownedBy(bob), select: { id: true } });
    assert.equal(rows.some((row) => row.id === aliceEntryId), false);
  });
});

describe("task notifications", () => {
  it("notifies the assignee when a task is assigned", async (t) => {
    if (!reachable) return t.skip("no database");
    const result = await notifyTaskAssigned(aliceEntryId);
    assert.equal(result.created, true);

    const notification = await prisma.notification.findUnique({
      where: { dedupeKey: assignedKey(aliceEntryId, alice) },
    });
    assert.equal(notification?.employeeId, alice);
    assert.equal(notification?.url, `/employee/tasks/${aliceEntryId}`);
  });

  it("does not assign the same task twice", async (t) => {
    if (!reachable) return t.skip("no database");
    const again = await notifyTaskAssigned(aliceEntryId);
    assert.equal(again.created, false);
    assert.equal(again.skipped, "duplicate");
  });

  it("stays silent when nothing meaningful changed", async (t) => {
    if (!reachable) return t.skip("no database");
    const entry = await prisma.projectTaskEntry.findUniqueOrThrow({
      where: { id: aliceEntryId },
      include: { task: { select: { name: true } } },
    });
    const snapshot = snapshotOf(entry);
    const result = await notifyTaskUpdated(aliceEntryId, snapshot, snapshot);
    assert.equal(result.created, false);
    assert.equal(result.skipped, "no-meaningful-change");
  });

  it("notifies on a real change", async (t) => {
    if (!reachable) return t.skip("no database");
    const entry = await prisma.projectTaskEntry.findUniqueOrThrow({
      where: { id: aliceEntryId },
      include: { task: { select: { name: true } } },
    });
    const before = snapshotOf(entry);
    const after = { ...before, priority: "HIGH" as const };

    const result = await notifyTaskUpdated(aliceEntryId, before, after);
    assert.equal(result.created, true);
  });

  it("respects a disabled preference", async (t) => {
    if (!reachable) return t.skip("no database");
    await prisma.notificationPreference.upsert({
      where: { employeeId: alice },
      create: { employeeId: alice, taskUpdated: false },
      update: { taskUpdated: false },
    });

    const entry = await prisma.projectTaskEntry.findUniqueOrThrow({
      where: { id: aliceEntryId },
      include: { task: { select: { name: true } } },
    });
    const before = snapshotOf(entry);
    const result = await notifyTaskUpdated(aliceEntryId, before, { ...before, priority: "LOW" as const });

    assert.equal(result.created, false);
    assert.equal(result.skipped, "preference");

    await prisma.notificationPreference.update({ where: { employeeId: alice }, data: { taskUpdated: true } });
  });

  it("sends nothing to a disabled employee", async (t) => {
    if (!reachable) return t.skip("no database");
    const result = await dispatchNotification({
      employeeId: disabled,
      type: "SYSTEM_NOTIFICATION",
      title: "Should not arrive",
      message: "Disabled account",
      url: "/employee",
      dedupeKey: `${PREFIX}disabled`,
    });
    assert.equal(result.created, false);
    assert.equal(result.skipped, "inactive-employee");
    assert.equal(await prisma.notification.count({ where: { employeeId: disabled } }), 0);
  });
});

describe("daily schedule job", () => {
  it("sends one summary per employee and survives a double run", async (t) => {
    if (!reachable) return t.skip("no database");

    const first = await runScheduleNotifier("tomorrow");
    const second = await runScheduleNotifier("tomorrow");

    const forAlice = first.employees.find((row) => row.employeeId === alice);
    assert.ok(forAlice, "Alice has a task scheduled for tomorrow");
    assert.equal(forAlice.created, true);
    assert.equal(forAlice.count, 1);

    // The second run must not write a second notification.
    const repeat = second.employees.find((row) => row.employeeId === alice);
    assert.equal(repeat?.created, false);
    assert.equal(repeat?.skipped, "duplicate");

    const summaries = await prisma.notification.count({
      where: { employeeId: alice, type: "TASK_TOMORROW_SCHEDULE" },
    });
    assert.equal(summaries, 1, "one summary notification, not one per task and not one per run");
  });
});

describe("multiple devices", () => {
  it("keeps every device of an employee, and only theirs", async (t) => {
    if (!reachable) return t.skip("no database");

    for (const device of ["iphone", "desktop", "android"]) {
      await prisma.pushSubscription.create({
        data: {
          employeeId: alice,
          endpoint: `https://push.example/${PREFIX}${device}`,
          p256dh: "key",
          auth: "auth",
          userAgent: device,
        },
      });
    }
    await prisma.pushSubscription.create({
      data: {
        employeeId: bob,
        endpoint: `https://push.example/${PREFIX}bob-phone`,
        p256dh: "key",
        auth: "auth",
      },
    });

    // The fan-out query the engine uses returns all of Alice's devices...
    const alices = await prisma.pushSubscription.findMany({ where: { employeeId: alice, active: true } });
    assert.equal(alices.length, 3);
    // ...and none of Bob's.
    assert.equal(alices.some((s) => s.endpoint.includes("bob")), false);
  });
});

describe("a section held on a project", () => {
  // Giving someone a section of one project — from the project's row on the
  // board — hands them every step of it there. The portal, the monthly figure
  // and the day all have to agree on who that is, or somebody is shown, and
  // scored on, work that is not theirs.
  it("belongs to the holder, not to the step's standing owner", async (t) => {
    if (!reachable) return t.skip("no database");

    const timezone = await getTimezone();
    const today = todayKey(timezone);
    const period = periodOf(today);
    type Row = { employee: { id: string }; counts: { total: number } };
    const total = (rows: Row[], id: string) => rows.find((row) => row.employee.id === id)?.counts.total ?? 0;

    const section = await prisma.processSection.create({ data: { name: `${PREFIX}Section`, order: 900 } });
    const step = await prisma.processTask.create({
      data: { name: `${PREFIX}Held step`, employeeId: alice, sectionId: section.id, order: 902 },
    });
    const entry = await prisma.projectTaskEntry.create({
      data: { projectId, taskId: step.id, scheduledFor: dayKeyToDate(today) },
    });

    // Alice owns the step, so until the section is handed out it is hers.
    assert.ok(await taskForEmployee(alice, entry.id));
    const monthBefore = await getEmployeeProgress(period);
    const dayBefore = await getDailyProgress(today);

    await prisma.projectSectionAssignment.create({
      data: { projectId, sectionId: section.id, employeeId: bob },
    });

    // The portal.
    assert.ok(await taskForEmployee(bob, entry.id), "Bob holds the section here, so the step is his");
    assert.equal(await taskForEmployee(alice, entry.id), null, "Alice only owns the step elsewhere");
    assert.ok((await allTasks(bob)).some((task) => task.id === entry.id));
    assert.ok((await allTasks(alice)).every((task) => task.id !== entry.id));

    // The monthly figure moves with it.
    const monthAfter = await getEmployeeProgress(period);
    assert.equal(total(monthAfter, bob) - total(monthBefore, bob), 1);
    assert.equal(total(monthAfter, alice) - total(monthBefore, alice), -1);

    // And so does the day.
    const dayAfter = await getDailyProgress(today);
    assert.equal(total(dayAfter, bob) - total(dayBefore, bob), 1);
    assert.equal(total(dayAfter, alice) - total(dayBefore, alice), -1);

    // The notification about it goes to the holder too.
    const told = await notifyTaskAssigned(entry.id);
    assert.equal(told.created, true);
    const notification = await prisma.notification.findUnique({ where: { dedupeKey: assignedKey(entry.id, bob) } });
    assert.equal(notification?.employeeId, bob);
  });
});
