import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CUTOFF_TIME,
  chargeable,
  cutoffOn,
  cutoffPhase,
  dayCounts,
  handedIn,
  hoursAsMoney,
  readManualCutoff,
  taskDedupe,
} from "../src/lib/task-cutoff";

// Money taken off for a task not handed in by nine, and the manager's own
// cutoffs. Every safeguard here is the difference between a rule and an
// unfair one, so each is pinned.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");
const at = (iso: string) => new Date(iso);
// 21:00 in Amman on 14 October is 18:00 UTC.
const cutoffAt = at("2026-10-14T18:00:00Z");
const job = (state: Parameters<typeof handedIn>[0], createdAt: string, siteVisitId: string | null = null) => ({
  state,
  createdAt: at(createdAt),
  siteVisitId,
});

describe("the end-of-day rule", () => {
  it("is on unless it was switched off", () => {
    assert.equal(cutoffOn(null), true);
    assert.equal(cutoffOn("true"), true);
    assert.equal(cutoffOn("false"), false);
  });

  it("warns an hour before and charges at the end of the day", () => {
    assert.equal(CUTOFF_TIME, "23:59");

    // Minutes past midnight, because the cutoff is a minute before midnight and
    // no whole hour can say that.
    const at = (time: string) => {
      const [h, m] = time.split(":").map(Number);
      return h * 60 + m;
    };

    assert.equal(cutoffPhase(at("19:00")), "before");
    assert.equal(cutoffPhase(at("22:58")), "before");
    assert.equal(cutoffPhase(at("22:59")), "warn");
    assert.equal(cutoffPhase(at("23:58")), "warn", "still only a warning a minute before");
    assert.equal(cutoffPhase(at("23:59")), "charge");
  });

  // Told at noon, nobody is charged that evening.
  it("counts only days after the one it was announced on", () => {
    assert.equal(dayCounts("2026-10-13", "2026-10-13"), false);
    assert.equal(dayCounts("2026-10-14", "2026-10-13"), true);
    assert.equal(dayCounts("2026-10-12", "2026-10-13"), false);
    assert.equal(dayCounts("2026-10-14", null), false);
  });

  it("treats work with the manager as handed in", () => {
    assert.equal(handedIn("SUBMITTED"), true);
    assert.equal(handedIn("DONE"), true);
    assert.equal(handedIn("TODO"), false);
    assert.equal(handedIn("IN_PROGRESS"), false);
    assert.equal(handedIn("TOMORROW"), false);
  });

  it("charges a job that is still out", () => {
    assert.equal(chargeable(job("TODO", "2026-10-14T08:00:00Z"), cutoffAt), true);
    assert.equal(chargeable(job("IN_PROGRESS", "2026-10-10T08:00:00Z"), cutoffAt), true);
    assert.equal(chargeable(job("SUBMITTED", "2026-10-14T08:00:00Z"), cutoffAt), false);
    assert.equal(chargeable(job("DONE", "2026-10-14T08:00:00Z"), cutoffAt), false);
  });

  // "By nine tonight", said at half past eight, is not a deadline.
  it("does not charge a job handed out in the last three hours", () => {
    assert.equal(chargeable(job("TODO", "2026-10-14T15:00:00Z"), cutoffAt), true, "18:00 Amman, three hours' notice");
    assert.equal(chargeable(job("TODO", "2026-10-14T15:01:00Z"), cutoffAt), false);
    assert.equal(chargeable(job("TODO", "2026-10-14T17:30:00Z"), cutoffAt), false);
  });

  // A visit is finished by writing it up in the diary, and has its own chase.
  it("leaves a site visit's job alone", () => {
    assert.equal(chargeable(job("TODO", "2026-10-14T08:00:00Z", "visit1"), cutoffAt), false);
  });

  it("charges a task once, whatever is done to its dates afterwards", () => {
    assert.equal(taskDedupe("job1"), "TASK:job1");
    assert.match(read("prisma", "schema.prisma"), /dedupeKey\s+String\?\s+@unique/);
  });

  it("prices an hour the way payroll does", () => {
    // 520 a month ÷ 26 days ÷ 8 hours.
    assert.equal(hoursAsMoney(520, "MONTHLY", 1), 2.5);
    assert.equal(hoursAsMoney(520, "MONTHLY", 3), 7.5);
    assert.equal(hoursAsMoney(null, "MONTHLY", 1), 0);
    assert.equal(hoursAsMoney(520, "MONTHLY", 0), 0);
    assert.equal(hoursAsMoney(520, "MONTHLY", -2), 0);
  });
});

describe("the manager's own cutoff", () => {
  it("is hours of pay or an amount", () => {
    assert.deepEqual(readManualCutoff({ hours: "2", amount: "" }), { hours: 2, amount: null });
    assert.deepEqual(readManualCutoff({ hours: "", amount: "3.5" }), { hours: null, amount: 3.5 });
    assert.deepEqual(readManualCutoff({ hours: "1", amount: "9" }), { hours: 1, amount: null }, "hours win");
  });

  // Number("") is 0: an empty form must not become a deduction of nothing.
  it("is nothing when neither was typed", () => {
    assert.equal(readManualCutoff({ hours: "", amount: "" }), null);
    assert.equal(readManualCutoff({ hours: null, amount: undefined }), null);
    assert.equal(readManualCutoff({ hours: "0", amount: "0" }), null);
    assert.equal(readManualCutoff({ hours: "-1", amount: "abc" }), null);
  });
});

// Each of these typechecks, builds and passes every other test when it is wrong.
describe("who may take money off", () => {
  const actions = read("src", "lib", "actions", "deduction-actions.ts");

  it("is the manager, in every export, answering in words", () => {
    const exports = actions.match(/^export async function \w+/gm) ?? [];
    assert.equal(exports.length, 3);
    assert.equal((actions.match(/await requireAdmin\(\);/g) ?? []).length, exports.length);
    assert.equal(actions.includes("throw new Error("), false);
    assert.equal(actions.includes("requireStaff"), false);
  });

  it("needs a reason, because the person is told it", () => {
    assert.match(actions, /if \(!reason\) throw new Refusal\(/);
  });

  // Turned off and on again, nobody is charged under a rule they were told had ended.
  it("forgets the announcement when the rule is turned off", () => {
    assert.match(actions, /if \(!on\) await prisma\.appSetting\.deleteMany\(\{ where: \{ key: CUTOFF_ANNOUNCED \} \}\)/);
  });

  it("reaches pay through the same total as every other adjustment, unless taken back", () => {
    const queries = read("src", "lib", "payroll-queries.ts");
    // Cutoffs join the manager's own adjustments in one list, and that list is
    // what the rate-free total is taken from.
    assert.match(queries, /\.\.\.deductions\.filter\(\(row\) => row\.employeeId === employee\.id && within\(dateToDayKey\(row\.day\)\)\)/);
    assert.match(queries, /adjustmentTotal: sum\(adjusted, \(row\) => row\.amount\)/);
    // Read by the day each is for, which is the same set for a month and the
    // only way to put one in the right week. Taken-back ones stay out.
    assert.match(read("src", "lib", "deduction-store.ts"), /where: \{ day: \{ gte: from, lte: to \}, cancelledAt: null \}/);
  });

  // An evening the server could not warn is one it could not take the work in.
  it("charges only somebody who was warned that evening", () => {
    const runner = read("src", "lib", "notifications", "task-cutoff-events.ts");
    assert.match(runner, /if \(!warnedIds\.has\(person\.id\)\) continue;/);
    assert.match(runner, /!isWorkingDay\(hours, dayKey\) \|\| !dayCounts\(dayKey, announcedDay\)/);
  });
});

describe("routine tasks", () => {
  it("are ordinary jobs, one per routine per day", () => {
    assert.match(read("prisma", "schema.prisma"), /@@unique\(\[routineId, startDay\]\)/);
    const store = read("src", "lib", "routine-store.ts");
    assert.match(store, /if \(!isWorkingDay\(await getWorkHours\(\), dayKey\)\)/);
    assert.match(store, /routineId: routine\.id/);
  });

  it("are the manager's to set, and are made before the evening's cutoffs are counted", () => {
    const actions = read("src", "lib", "actions", "routine-actions.ts");
    const exports = actions.match(/^export async function \w+/gm) ?? [];
    assert.equal((actions.match(/await requireAdmin\(\);/g) ?? []).length, exports.length);
    const cron = read("src", "app", "api", "cron", "notifications", "route.ts");
    assert.ok(cron.indexOf("ensureTodaysRoutines(new Date())") < cron.indexOf("runTaskCutoffs(new Date())"));
  });
});

describe("answering a review", () => {
  // A page runs its actions one at a time, so each approval waited on the
  // phone notification of the one before it.
  it("does not wait on the person's phone", () => {
    const actions = read("src", "lib", "actions", "submission-actions.ts");
    assert.equal((actions.match(/after\(\(\) =>\n\s+dispatchNotification\(/g) ?? []).length, 2);
    assert.equal(/await dispatchNotification\(\{\n\s+employeeId: submission\.employeeId/.test(actions), false);
  });

  it("takes the card off the screen at once, and holds the live refresh off", () => {
    const buttons = read("src", "components", "admin", "review-actions.tsx");
    assert.ok(buttons.indexOf("item?.leave();") < buttons.indexOf("void whileBusy("));
    assert.match(buttons, /item\?\.comeBack\(\);/);
  });
});
