import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { prisma } from "@/lib/db";
import { addManualDeduction, cancelDeduction, chargeLateTask } from "@/lib/deduction-store";
import { getPayrollForPeriod } from "@/lib/payroll-queries";
import { ensureTodaysRoutines } from "@/lib/routine-store";
import { dayKeyToDate } from "@/lib/time";
import { databaseTarget } from "./db-target";

// Refuses the studio's live database outright — see tests/db-target.ts. At the
// top of the file on purpose: inside `before` the throw reads as a skip.
const target = databaseTarget(process.env.DATABASE_URL);
if (!target.safe) throw new Error(target.why);

// Cutoffs and routines against a real database: a late task is charged once
// however often the pass runs, a cutoff reaches pay and leaves it when taken
// back, and a routine makes one job a day and no more.
//
// The scheduler's runner is not called here: it tells the whole team, and in a
// development copy of the studio's data the team have real phones.
//
// Run with: npm run test:db   (needs the local dev database up)

const PREFIX = "ztest-cut-";
const DAY = "2031-03-10";
const PERIOD = "2031-03";

let reachable = false;
let person: { id: string; salaryAmount: number | null; payBasis: "MONTHLY" | "WEEKLY" };
let jobId = "";

async function cleanup() {
  await prisma.employee.deleteMany({ where: { name: { startsWith: PREFIX } } });
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

  // 520 a month is 2.50 an hour.
  person = await prisma.employee.create({
    data: { name: `${PREFIX}Amal`, email: `${PREFIX}amal@test.local`, active: true, accessRole: "EMPLOYEE", salaryAmount: 520 },
    select: { id: true, salaryAmount: true, payBasis: true },
  });
  const job = await prisma.assignedTask.create({
    data: { employeeId: person.id, title: "Send the drawings", startDay: dayKeyToDate(DAY), endDay: dayKeyToDate(DAY) },
  });
  jobId = job.id;
});

after(async () => {
  if (reachable) await cleanup();
  await prisma.$disconnect();
});

const payOf = async () => (await getPayrollForPeriod(PERIOD)).find((row) => row.employee.id === person.id)!;

describe("cutoffs", () => {
  it("charge a late task one hour, once, however often the pass runs", async (t) => {
    if (!reachable) return t.skip("no database");

    assert.equal(await chargeLateTask({ id: jobId, title: "Send the drawings" }, person, DAY), true);
    assert.equal(await chargeLateTask({ id: jobId, title: "Send the drawings" }, person, DAY), false);

    const rows = await prisma.deduction.findMany({ where: { employeeId: person.id } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].hours, 1);
    assert.equal(rows[0].amount, 2.5);
    assert.equal(rows[0].periodKey, PERIOD);
  });

  it("reach pay, with the reason, beside the manager's own", async (t) => {
    if (!reachable) return t.skip("no database");

    await addManualDeduction({ employeeId: person.id, dayKey: DAY, hours: 2, amount: null, reason: "Left the site unlocked" });
    await addManualDeduction({ employeeId: person.id, dayKey: DAY, hours: null, amount: 4, reason: "Lost the key" });

    const pay = await payOf();
    // 2.50 for the task, 5.00 for two hours, 4.00 typed.
    assert.equal(pay.breakdown.adjustmentTotal, 11.5);
    assert.equal(pay.breakdown.finalPay, 508.5);
    assert.deepEqual(
      pay.adjustments.map((row) => row.reason).sort(),
      ["Left the site unlocked", "Lost the key", "Not handed in by 9:00 PM: Send the drawings"]
    );
  });

  it("leave pay when taken back, and stay on record", async (t) => {
    if (!reachable) return t.skip("no database");

    const task = await prisma.deduction.findFirstOrThrow({ where: { employeeId: person.id, kind: "TASK" } });
    assert.equal((await cancelDeduction(task.id))?.amount, 2.5);
    assert.equal(await cancelDeduction(task.id), null, "taking it back twice is not a second refund");

    assert.equal((await payOf()).breakdown.adjustmentTotal, 9);
    assert.equal(await prisma.deduction.count({ where: { employeeId: person.id } }), 3);
    // And it is not charged again: the task was charged once, ever.
    assert.equal(await chargeLateTask({ id: jobId, title: "Send the drawings" }, person, DAY), false);
  });
});

describe("a routine task", () => {
  it("makes one job a working day, and no second one on the next pass", async (t) => {
    if (!reachable) return t.skip("no database");

    const routine = await prisma.routineTask.create({
      data: { employeeId: person.id, title: "Open the office", acceptance: "Lights on", priority: "HIGH" },
    });

    const first = await ensureTodaysRoutines(new Date(), routine.id);
    const second = await ensureTodaysRoutines(new Date(), routine.id);
    const made = await prisma.assignedTask.findMany({ where: { routineId: routine.id } });

    if (!first.working) {
      // A day the studio does not work makes none at all.
      assert.equal(made.length, 0);
      return;
    }
    assert.equal(first.made, 1);
    assert.equal(second.made, 0);
    assert.equal(made.length, 1);
    assert.equal(made[0].title, "Open the office");
    assert.equal(made[0].acceptance, "Lights on");
    assert.equal(made[0].priority, "HIGH");
    assert.equal(made[0].startDay.getTime(), made[0].endDay.getTime());

    // Paused, it makes no more; removed, the day it made stays.
    await prisma.routineTask.delete({ where: { id: routine.id } });
    assert.equal(await prisma.assignedTask.count({ where: { id: made[0].id, routineId: null } }), 1);
  });
});
