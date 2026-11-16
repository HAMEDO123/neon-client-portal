import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  doneTasksCsv,
  finishedLate,
  monthBounds,
  readMonth,
  reportsCsv,
  weekdayOf,
  type DoneRow,
  type ReportRow,
} from "../src/lib/monthly-export";

// The month's reports and the month's finished work, as the two files the
// manager asked for (2026-11-16).

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
  const rows: ReportRow[] = [
    {
      person: "Wael",
      role: "Site",
      dayKey: "2026-11-01",
      text: "10:00 — site\n12:00 — supplier",
      lastEdited: "6:40 PM",
    },
    { person: "Wael", role: "Site", dayKey: "2026-11-02", text: "=SUM(A1)", lastEdited: "6:10 PM" },
    { person: "سالي", role: null, dayKey: "2026-11-01", text: "تصوير ستوري", lastEdited: "5:00 PM" },
  ];
  const csv = reportsCsv(rows);

  it("opens as UTF-8 in Excel", () => {
    assert.ok(csv.startsWith("﻿"));
    assert.ok(csv.includes("سالي"));
  });

  it("is one row a report, each person day by day, the report kept whole in one cell", () => {
    const out = lines(csv);
    assert.equal(out[0], "Employee,Role,Date,Day,Report,Last edited");
    // A line break inside a report is a line inside the cell, not a new row.
    assert.equal(out[1], 'Wael,Site,2026-11-01,Sun,"10:00 — site\n12:00 — supplier",6:40 PM');
  });

  it("never runs a formula somebody typed", () => {
    assert.ok(csv.includes("'=SUM(A1)"));
  });

  it("ends with how many days each person reported", () => {
    const out = lines(csv);
    const at = out.indexOf("Employee,Days reported");
    assert.ok(at > 0);
    assert.deepEqual(out.slice(at + 1, at + 3), ["Wael,2", "سالي,1"]);
  });
});

describe("the tasks-done file", () => {
  const base: DoneRow = {
    person: "Salem",
    doneKey: "2026-11-14",
    doneAt: "3:00 PM",
    sentKey: "2026-11-14",
    title: "سستم كاش",
    kind: "Job",
    project: null,
    startKey: "2026-11-14",
    dueKey: "2026-11-14",
    priority: "HIGH",
    assignedBy: "Sally",
  };

  it("calls late what was handed in after its last day, however late it was approved", () => {
    assert.equal(finishedLate(base), false, "sent on the day is on time");
    assert.equal(
      finishedLate({ sentKey: "2026-11-14", doneKey: "2026-11-20", dueKey: "2026-11-14" }),
      false,
      "approved a week later is the manager's week, not theirs"
    );
    assert.equal(finishedLate({ sentKey: "2026-11-15", doneKey: "2026-11-15", dueKey: "2026-11-14" }), true);
    // Ticked off by the manager with nothing sent: the approval is the only date.
    assert.equal(finishedLate({ sentKey: null, doneKey: "2026-11-15", dueKey: "2026-11-14" }), true);
    assert.equal(
      finishedLate({ sentKey: null, doneKey: "2026-11-15", dueKey: null }),
      false,
      "no deadline, never late"
    );
  });

  it("has a row per task with who handed it out, and a count per person", () => {
    const csv = doneTasksCsv([
      base,
      { ...base, title: "Late one", sentKey: "2026-11-16", doneKey: "2026-11-16", priority: "MEDIUM" },
      { ...base, person: "Wael", kind: "Project step", project: "Villa", dueKey: null, assignedBy: "Project board" },
    ]);
    const out = lines(csv);
    assert.equal(
      out[0],
      "Employee,Done on,Day,Approved at,Sent for review,Task,Type,Project,From,Due,Late,Priority,Assigned by"
    );
    assert.equal(out[1], "Salem,2026-11-14,Sat,3:00 PM,2026-11-14,سستم كاش,Job,,2026-11-14,2026-11-14,,High,Sally");
    assert.match(out[2], /,Late,Medium,Sally$/);
    assert.match(out[3], /^Wael,.*,Project step,Villa,2026-11-14,,,High,Project board$/);

    const at = out.indexOf("Employee,Tasks done,Of them late");
    assert.deepEqual(out.slice(at + 1, at + 3), ["Salem,2,1", "Wael,1,0"]);
  });
});

describe("the files are the manager's", () => {
  for (const route of ["requests/reports.csv", "tasks/done.csv"]) {
    it(`${route} checks for the manager itself and answers nobody else`, () => {
      const source = read("src", "app", "admin", "(dashboard)", ...route.split("/"), "route.ts");
      assert.match(
        source,
        /if \(!\(await hasAdminSession\(\)\)\) return new NextResponse\("Not found", \{ status: 404 \}\)/
      );
      assert.match(source, /"cache-control": "no-store"/);
    });
  }

  it("counts only approved work as done", () => {
    const source = read("src", "lib", "monthly-export.ts");
    assert.match(source, /state: "DONE" as const, completedAt: \{ gte: from, lt: until \}/);
  });
});
