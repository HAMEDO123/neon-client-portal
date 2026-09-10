import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dayCounts,
  dayHeading,
  daysEnding,
  groupDaily,
  jobOnDay,
  sumCounts,
  type DayStep,
} from "../src/lib/daily-progress";
import { holderKey, ownerOf } from "../src/lib/ownership";

const step = (overrides: Partial<DayStep>): DayStep => ({
  id: "s",
  state: "TODO",
  dayKey: "2026-09-10",
  excludedFromProgress: false,
  assigneeId: null,
  projectId: "villa",
  projectName: "Villa",
  stepName: "BOQ",
  stepOwnerId: "alice",
  sectionId: null,
  ...overrides,
});

describe("who a cell belongs to", () => {
  it("is the person named on it, then the section holder, then the step owner", () => {
    assert.equal(ownerOf("cara", { employeeId: "alice" }, "bob"), "cara");
    assert.equal(ownerOf(null, { employeeId: "alice" }, "bob"), "bob");
    assert.equal(ownerOf(null, { employeeId: "alice" }, null), "alice");
    assert.equal(ownerOf(null, { employeeId: null }, undefined), null);
  });
});

describe("what is on a day's list", () => {
  const job = { startKey: "2026-09-08", endKey: "2026-09-09", state: "TODO" };

  it("holds a job across its days", () => {
    assert.equal(jobOnDay(job, "2026-09-07"), false);
    assert.equal(jobOnDay(job, "2026-09-08"), true);
    assert.equal(jobOnDay(job, "2026-09-09"), true);
  });

  it("keeps a late job on the list until it is done", () => {
    assert.equal(jobOnDay(job, "2026-09-12"), true);
    assert.equal(jobOnDay({ ...job, state: "DONE" }, "2026-09-12"), false);
    assert.equal(jobOnDay({ ...job, state: "DONE" }, "2026-09-09"), true);
  });

  it("leaves out the cells marked not counted", () => {
    const counts = dayCounts(
      [
        { state: "DONE", excludedFromProgress: false },
        { state: "TODO", excludedFromProgress: true },
      ],
      [{ startKey: "2026-09-10", endKey: "2026-09-10", state: "IN_PROGRESS" }],
      "2026-09-10"
    );
    assert.deepEqual(counts, { done: 1, review: 0, working: 1, pending: 0, total: 2 });
  });

  it("adds the team up", () => {
    assert.deepEqual(
      sumCounts([
        { done: 1, review: 0, working: 1, pending: 2, total: 4 },
        { done: 2, review: 1, working: 0, pending: 0, total: 3 },
      ]),
      { done: 3, review: 1, working: 1, pending: 2, total: 7 }
    );
  });
});

describe("the days around the one being looked at", () => {
  it("runs back from the chosen day, across a month's end", () => {
    assert.deepEqual(daysEnding("2026-09-10", 3), ["2026-09-08", "2026-09-09", "2026-09-10"]);
    assert.deepEqual(daysEnding("2026-09-01", 2), ["2026-08-31", "2026-09-01"]);
  });

  it("names today, yesterday and tomorrow", () => {
    assert.equal(dayHeading("2026-09-10", "2026-09-10"), "Today · Thursday 10 September");
    assert.equal(dayHeading("2026-09-09", "2026-09-10"), "Yesterday · Wednesday 9 September");
    assert.equal(dayHeading("2026-09-11", "2026-09-10"), "Tomorrow · Friday 11 September");
    assert.equal(dayHeading("2026-09-01", "2026-09-10"), "Tuesday 1 September");
  });
});

describe("everyone's day at once", () => {
  it("gives a held section's steps to its holder, and a named person beats both", () => {
    const byPerson = groupDaily({
      employeeIds: ["alice", "bob", "cara"],
      steps: [
        step({ id: "a" }),
        step({ id: "b", sectionId: "site" }),
        step({ id: "c", sectionId: "site", assigneeId: "cara" }),
      ],
      jobs: [],
      sectionHolders: new Map([[holderKey("villa", "site"), "bob"]]),
      days: ["2026-09-10"],
    });

    assert.equal(byPerson.get("alice")!.counts.total, 1);
    assert.equal(byPerson.get("bob")!.counts.total, 1);
    assert.equal(byPerson.get("cara")!.counts.total, 1);
  });

  it("counts every day of the strip, and the chosen day is the last", () => {
    const byPerson = groupDaily({
      employeeIds: ["alice"],
      steps: [
        step({ id: "1", dayKey: "2026-09-09", state: "DONE" }),
        step({ id: "2", dayKey: "2026-09-10", state: "TODO" }),
        step({ id: "3", dayKey: "2026-09-10", state: "DONE" }),
      ],
      jobs: [
        {
          id: "j",
          employeeId: "alice",
          title: "Supplier",
          startKey: "2026-09-09",
          endKey: "2026-09-10",
          state: "IN_PROGRESS",
        },
      ],
      sectionHolders: new Map(),
      days: ["2026-09-08", "2026-09-09", "2026-09-10"],
    });

    const alice = byPerson.get("alice")!;
    assert.deepEqual(alice.history, [
      { dayKey: "2026-09-08", done: 0, total: 0 },
      { dayKey: "2026-09-09", done: 1, total: 2 },
      { dayKey: "2026-09-10", done: 1, total: 3 },
    ]);
    assert.deepEqual(alice.counts, { done: 1, review: 0, working: 1, pending: 1, total: 3 });
  });

  it("lists what someone is working on now, whichever day it is on", () => {
    const byPerson = groupDaily({
      employeeIds: ["alice"],
      steps: [step({ id: "old", dayKey: "2026-08-01", state: "IN_PROGRESS", stepName: "Ceiling", projectName: "Watin" })],
      jobs: [
        {
          id: "j",
          employeeId: "alice",
          title: "Supplier",
          startKey: "2026-09-20",
          endKey: "2026-09-21",
          state: "IN_PROGRESS",
        },
      ],
      sectionHolders: new Map(),
      days: ["2026-09-10"],
    });

    const alice = byPerson.get("alice")!;
    assert.deepEqual(alice.working, [
      { id: "old", title: "Ceiling", project: "Watin" },
      { id: "j", title: "Supplier", project: null },
    ]);
    assert.equal(alice.counts.total, 0, "neither is on the 10th");
  });
});
