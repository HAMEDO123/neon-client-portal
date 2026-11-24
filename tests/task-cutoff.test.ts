import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  CUTOFF_TIME,
  chargeable,
  cutoffOn,
  cutoffPhase,
  daysToCharge,
  lateAt,
  roundAt,
  dayCounts,
  handedIn,
  hoursAsMoney,
  readManualCutoff,
  chargesForSendingBack,
  redeployDay,
  redeploysOn,
  sentBackDedupe,
  taskDedupe,
  CARRY_FROM,
  carriedCopy,
  carriesOver,
  carryDay,
  lateTaskKey,
} from "../src/lib/task-cutoff";
import type { WorkHours } from "../src/lib/work-hours";

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
    assert.match(runner, /team\.filter\(\(person\) => warnedIds\.has\(person\.id\)\)/);
    assert.match(runner, /!isWorkingDay\(hours, day\) \|\| !dayCounts\(day, announcedDay\)/);
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

describe("a job sent back is due again", () => {
  it("from 2026-11-20, not on the 19th", () => {
    assert.equal(redeploysOn("2026-11-19"), false);
    assert.equal(redeploysOn("2026-11-20"), true);
    const actions = readFileSync(join(process.cwd(), "src", "lib", "actions", "submission-actions.ts"), "utf8");
    assert.match(actions, /if \(!redeploysOn\(todayKey\)\) return null;/);
  });

  // Saturday to Thursday; 2026-11-19 is a Thursday, 2026-11-20 a Friday.
  const HOURS = { days: [0, 1, 2, 3, 4, 6] } as unknown as WorkHours;

  it("is due the same day it was sent back, whatever the hour", () => {
    assert.equal(redeployDay(HOURS, "2026-11-19"), "2026-11-19");
    // The owner, 2026-11-21: due again before 12 AM that same day — late in
    // the evening too, and even for a job that was due later.
    assert.equal(redeployDay(HOURS, "2026-11-21"), "2026-11-21");
  });

  it("goes to the next working day only when sent back on a day off", () => {
    // Friday is not worked.
    assert.equal(redeployDay(HOURS, "2026-11-20"), "2026-11-21");
  });

  it("charges each sending-back once, and keeps the old key for a job never sent back", () => {
    assert.equal(taskDedupe("t1"), "TASK:t1");
    assert.equal(taskDedupe("t1", 0), "TASK:t1");
    assert.notEqual(taskDedupe("t1", 1), taskDedupe("t1"));
    assert.notEqual(taskDedupe("t1", 2), taskDedupe("t1", 1));
  });
});

describe("being sent back cost an hour, there and then, on 2026-11-19 only", () => {
  it("on that day and no other", () => {
    assert.equal(chargesForSendingBack("2026-11-19"), true);
    assert.equal(chargesForSendingBack("2026-11-20"), false);
    assert.equal(chargesForSendingBack("2026-11-18"), false);
  });

  it("is charged by rejectSubmission, once per sending-back", () => {
    const actions = readFileSync(join(process.cwd(), "src", "lib", "actions", "submission-actions.ts"), "utf8");
    const body = actions.slice(actions.indexOf("export async function rejectSubmission("));
    assert.match(body.slice(0, 2500), /chargeSentBack\(\{\s*submissionId: submission\.id/);
    // The key the first of these were written under by hand.
    assert.equal(sentBackDedupe("s1"), "REJECTED:s1");
  });
});

// The cutoff is 23:59 and the scheduler passes every ten minutes, so a charge
// that only ran inside that minute never ran (25 Oct – 21 Nov 2026). Each pass
// charges yesterday too, judged by what was in at 23:59.
describe("charging after midnight", () => {
  const cutoff = new Date("2026-11-19T20:59:00Z"); // 23:59 Amman
  const sub = (createdAt: string, status: "PENDING" | "APPROVED" | "REJECTED" = "PENDING", reviewedAt: string | null = null) => ({
    createdAt: new Date(createdAt),
    reviewedAt: reviewedAt ? new Date(reviewedAt) : null,
    status,
  });
  const task = (state: "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE", submissions: ReturnType<typeof sub>[], completedAt: string | null = null) => ({
    state,
    createdAt: new Date("2026-11-19T08:00:00Z"),
    siteVisitId: null,
    completedAt: completedAt ? new Date(completedAt) : null,
    submissions,
  });

  it("charges yesterday on every pass, and today from 23:59", () => {
    assert.deepEqual(daysToCharge("2026-11-21", "before", "2026-11-20"), ["2026-11-20"]);
    assert.deepEqual(daysToCharge("2026-11-21", "warn", "2026-11-20"), ["2026-11-20"]);
    assert.deepEqual(daysToCharge("2026-11-21", "charge", "2026-11-20"), ["2026-11-20", "2026-11-21"]);
  });

  it("judges hand-ins by their time, not by the state now", () => {
    assert.equal(lateAt(task("IN_PROGRESS", []), cutoff), true);
    assert.equal(lateAt(task("SUBMITTED", [sub("2026-11-19T18:00:00Z")]), cutoff), false, "sent at 21:00");
    assert.equal(lateAt(task("SUBMITTED", [sub("2026-11-19T21:20:00Z")]), cutoff), true, "sent at 00:20 is late");
    assert.equal(lateAt(task("DONE", [sub("2026-11-19T21:20:00Z", "APPROVED")], "2026-11-20T08:00:00Z"), cutoff), true);
  });

  it("does not count a hand-in sent back before the cutoff", () => {
    const back = sub("2026-11-19T10:00:00Z", "REJECTED", "2026-11-19T12:00:00Z");
    assert.equal(lateAt(task("IN_PROGRESS", [back]), cutoff), true);
    assert.equal(roundAt([back], cutoff), 1);
    const later = sub("2026-11-19T10:00:00Z", "REJECTED", "2026-11-20T09:00:00Z");
    assert.equal(lateAt(task("IN_PROGRESS", [later]), cutoff), false, "it was in at 23:59");
    assert.equal(roundAt([later], cutoff), 0);
  });

  it("gives the benefit of the doubt to a job with no record of a hand-in", () => {
    assert.equal(lateAt(task("SUBMITTED", []), cutoff), false);
  });

  it("is what the scheduler runs", () => {
    const source = read("src", "lib", "notifications", "task-cutoff-events.ts");
    assert.match(source, /daysToCharge\(dayKey, phase, shiftDayKey\(dayKey, -1\)\)/);
    assert.match(source, /lateAt\(task, cutoffAt\)/);
  });
});

describe("a job not handed in comes back the next day as a new one (from 2026-11-24)", () => {
  const hours = { days: [0, 1, 2, 3, 4, 6] } as unknown as WorkHours;
  it("starts on the 24th, and the days before keep their rule", () => {
    assert.equal(CARRY_FROM, "2026-11-24");
    assert.equal(carriesOver("2026-11-23"), false);
    assert.equal(carriesOver("2026-11-24"), true);
  });
  it("comes back on the next day the studio works", () => {
    assert.equal(carryDay(hours, "2026-11-24"), "2026-11-25");
    assert.equal(carryDay(hours, "2026-11-26"), "2026-11-28", "Thursday's goes to Saturday, past the Friday off");
  });
  it("is charged once a day it stays out, and never twice for one day", () => {
    assert.equal(lateTaskKey("t1", "2026-11-23"), "TASK:t1", "an old day keeps its old key");
    assert.equal(lateTaskKey("t1", "2026-11-23", 2), taskDedupe("t1", 2));
    assert.equal(lateTaskKey("t1", "2026-11-24"), lateTaskKey("t1", "2026-11-24", 1));
    assert.notEqual(lateTaskKey("t1", "2026-11-24"), lateTaskKey("t1", "2026-11-25"));
  });
  it("is told as a new job", () => {
    assert.equal(carriedCopy("Send the drawings", "2026-11-25", "2026-11-24").message, "Send the drawings — tomorrow's job.");
    assert.equal(carriedCopy("Send the drawings", "2026-11-25", "2026-11-25").message, "Send the drawings — today's job.");
  });
  it("moves the job in the runner, but never a routine's", () => {
    const runner = read("src", "lib", "notifications", "task-cutoff-events.ts");
    assert.match(runner, /if \(task\.routineId\) continue;/);
    assert.match(runner, /where: \{ id: task\.id, endDay: dayKeyToDate\(dayKey\) \}/);
  });
});
