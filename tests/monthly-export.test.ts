import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  isLateTask,
  monthBounds,
  readMonth,
  reportDays,
  reportsCsv,
  taskStatus,
  tasksCsv,
  weekdayOf,
  type ReportPerson,
  type TaskRow,
} from "../src/lib/monthly-export";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";

// The month's reports and the month's tasks, as the two files the manager
// asked for (2026-11-16) — and asked for whole the day after: what was in each
// report and each task, and where nothing came, "same for the report".

const read = (...path: string[]) => readFileSync(join(process.cwd(), ...path), "utf8");
const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("the month", () => {
  it("is the studio's period, read from the address or the one today is in", () => {
    assert.equal(readMonth("2026-10", "2026-11-16"), "2026-10");
    assert.equal(readMonth(null, "2026-11-16"), "2026-11");
    // The 1st to the 4th are still last month's period.
    assert.equal(readMonth(null, "2026-12-03"), "2026-11");
    assert.equal(readMonth("2026-13", "2026-11-16"), "2026-11");
    assert.equal(readMonth("nonsense", "2026-11-16"), "2026-11");
  });

  // "the same period from 5th to 4th is each month" — the owner, 2026-11-16.
  it("runs the 5th to the 5th, across the turn of the year", () => {
    assert.deepEqual(monthBounds("2026-11"), { first: "2026-11-05", next: "2026-12-05" });
    assert.deepEqual(monthBounds("2026-12"), { first: "2026-12-05", next: "2027-01-05" });
  });

  it("asks payroll where a month starts rather than knowing it", () => {
    const source = read("src", "lib", "monthly-export.ts");
    assert.match(source, /from "@\/lib\/pay-period"/);
    for (const page of ["requests", "tasks"]) {
      assert.match(read("src", "app", "admin", "(dashboard)", page, "page.tsx"), /month=\{periodOf\(today\)\}/, page);
    }
  });

  it("names a day the same on any machine", () => {
    assert.equal(weekdayOf("2026-11-16"), "Mon");
    assert.equal(weekdayOf("2026-11-20"), "Fri");
  });
});

describe("the reports file", () => {
  // The studio's week as saved: Saturday to Thursday, shut on Friday.
  const hours = { ...DEFAULT_WORK_HOURS, days: [0, 1, 2, 3, 4, 6] };
  // Fri 13 to Wed 18 November, read on Tue 17.
  const days = ["2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18"];
  const wael: ReportPerson = { id: "w", name: "Wael", role: "Site", active: true, sinceKey: "2026-10-01" };
  const rows = reportDays({
    people: [
      wael,
      { id: "n", name: "Newcomer", role: null, active: true, sinceKey: "2026-11-16" },
      { id: "g", name: "Gone", role: null, active: false, sinceKey: "2026-01-01" },
    ],
    reports: [
      { employeeId: "w", dayKey: "2026-11-14", text: "10:00 — site\n12:00 — supplier", lastEdited: "6:40 PM" },
      { employeeId: "w", dayKey: "2026-11-15", text: "=SUM(A1)", lastEdited: "6:10 PM" },
      { employeeId: "g", dayKey: "2026-11-14", text: "last day", lastEdited: "5:00 PM" },
    ],
    attendance: [{ employeeId: "w", dayKey: "2026-11-16", mark: "In 9:02 AM" }],
    days,
    hours,
    todayKey: "2026-11-17",
  });
  const of = (person: string) => rows.filter((row) => row.person === person);

  it("lists every working day so far, and says where nothing was written", () => {
    assert.deepEqual(
      of("Wael").map((row) => [row.dayKey, row.status]),
      [
        ["2026-11-14", "Written"],
        ["2026-11-15", "Written"],
        ["2026-11-16", "Not written"],
        ["2026-11-17", "Not written yet"],
      ],
      "Friday is shut, today is not over, tomorrow is not owed"
    );
  });

  it("says whether they were in, so a missing report can be read for what it is", () => {
    assert.equal(of("Wael").find((row) => row.dayKey === "2026-11-16")?.attendance, "In 9:02 AM");
    assert.equal(of("Wael").find((row) => row.dayKey === "2026-11-14")?.attendance, "No attendance");
  });

  it("owes nothing before somebody joined, and nothing from somebody who left", () => {
    assert.deepEqual(
      of("Newcomer").map((row) => row.dayKey),
      ["2026-11-16", "2026-11-17"]
    );
    assert.deepEqual(
      of("Gone").map((row) => [row.dayKey, row.status]),
      [["2026-11-14", "Written"]]
    );
  });

  it("is written whole, the report in one cell, with each person's count under it", () => {
    const csv = reportsCsv(rows);
    assert.ok(csv.startsWith("﻿"), "opens as UTF-8 in Excel");
    const out = lines(csv);
    assert.equal(out[0], "Employee,Role,Date,Day,Status,Report,Last edited,Attendance");
    // A line break inside a report is a line inside the cell, not a new row.
    assert.equal(out[1], 'Wael,Site,2026-11-14,Sat,Written,"10:00 — site\n12:00 — supplier",6:40 PM,No attendance');
    assert.equal(out[3], "Wael,Site,2026-11-16,Mon,Not written,,,In 9:02 AM");
    assert.ok(csv.includes("'=SUM(A1)"), "never runs a formula somebody typed");

    const at = out.indexOf("Employee,Days written,Days not written");
    assert.deepEqual(out.slice(at + 1, at + 4), ["Wael,2,1", "Newcomer,0,1", "Gone,1,0"]);
  });
});

describe("the tasks file", () => {
  const today = "2026-11-17";
  const base: TaskRow = {
    person: "Salem",
    title: "سستم كاش",
    kind: "Job",
    project: null,
    startKey: "2026-11-14",
    dueKey: "2026-11-14",
    state: "DONE",
    sentKey: "2026-11-14",
    doneKey: "2026-11-16",
    asked: "Cash system for the salon",
    deliverable: "Screenshot",
    acceptance: "Prints a receipt",
    employeeNote: "Done, printing works",
    proof: "https://example.r2.dev/submissions/a.png",
    managerNote: "",
    priority: "HIGH",
    assignedBy: "Sally",
  };

  it("says where each one stands, in words", () => {
    assert.equal(taskStatus(base, today), "Done");
    assert.equal(taskStatus({ state: "SUBMITTED", dueKey: "2026-11-10" }, today), "Sent — waiting for review");
    assert.equal(taskStatus({ state: "TODO", dueKey: "2026-11-16" }, today), "Not done");
    assert.equal(taskStatus({ state: "IN_PROGRESS", dueKey: today }, today), "Due today");
    assert.equal(taskStatus({ state: "TODO", dueKey: "2026-11-20" }, today), "Not due yet");
  });

  it("calls late what was handed in after its day, or never handed in once its day has gone", () => {
    assert.equal(isLateTask(base, today), false, "sent on the day; approved two days later is the manager's time");
    assert.equal(isLateTask({ ...base, sentKey: "2026-11-15" }, today), true);
    assert.equal(isLateTask({ ...base, sentKey: null, doneKey: "2026-11-15" }, today), true, "ticked off late");
    assert.equal(isLateTask({ state: "TODO", dueKey: "2026-11-16", sentKey: null, doneKey: null }, today), true);
    assert.equal(isLateTask({ state: "TODO", dueKey: today, sentKey: null, doneKey: null }, today), false);
    assert.equal(isLateTask({ state: "TODO", dueKey: null, sentKey: null, doneKey: null }, today), false);
  });

  it("has what was asked and what came back on every row, and a count per person", () => {
    const csv = tasksCsv(
      [
        base,
        {
          ...base,
          title: "Not sent",
          state: "TODO",
          sentKey: null,
          doneKey: null,
          employeeNote: "",
          proof: "",
          priority: "MEDIUM",
        },
        { ...base, person: "Wael", kind: "Project step", project: "Villa", state: "SUBMITTED", doneKey: null },
      ],
      today
    );
    const out = lines(csv);
    assert.equal(
      out[0],
      "Employee,Task,Type,Project,From,Due,Status,Late,Sent for review,Approved on,What was asked,What to hand in,Counts as done when,Employee's note,Proof,Manager's note,Priority,Assigned by"
    );
    assert.equal(
      out[1],
      'Salem,سستم كاش,Job,,2026-11-14,2026-11-14,Done,,2026-11-14,2026-11-16,Cash system for the salon,Screenshot,Prints a receipt,"Done, printing works",https://example.r2.dev/submissions/a.png,,High,Sally'
    );
    assert.match(out[2], /^Salem,Not sent,Job,,2026-11-14,2026-11-14,Not done,Late,,,/);
    assert.match(out[3], /^Wael,سستم كاش,Project step,Villa,.*,Sent — waiting for review,,2026-11-14,,/);

    const at = out.indexOf("Employee,Tasks,Done,Waiting for review,Not done,Late");
    assert.deepEqual(out.slice(at + 1, at + 3), ["Salem,2,1,0,1,1", "Wael,1,0,1,0,0"]);
  });
});

describe("the files are the manager's", () => {
  for (const route of ["requests/reports.csv", "tasks/tasks.csv"]) {
    it(`${route} checks for the manager itself and answers nobody else`, () => {
      const source = read("src", "app", "admin", "(dashboard)", ...route.split("/"), "route.ts");
      assert.match(
        source,
        /if \(!\(await hasAdminSession\(\)\)\) return new NextResponse\("Not found", \{ status: 404 \}\)/
      );
      assert.match(source, /"cache-control": "no-store"/);
    });
  }

  it("takes every task due in the period, and anything approved in it", () => {
    const source = read("src", "lib", "monthly-export.ts");
    assert.match(source, /endDay: \{ gte: dayKeyToDate\(first\), lt: dayKeyToDate\(next\) \} \}, approvedInPeriod\]/);
  });
});
