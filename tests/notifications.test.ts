import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignedKey,
  changedFields,
  deadlineKey,
  DEFAULT_PREFERENCES,
  describeChanges,
  isPushEnabled,
  isTypeEnabled,
  pushPayload,
  revisionStamp,
  scheduleCopy,
  scheduleKey,
  scheduleUrl,
  taskUrl,
  updatedKey,
  type TaskSnapshot,
} from "@/lib/notifications/types";
import { subscriptionOutcome } from "@/lib/notifications/push";
import { dayKeyIn, hourIn, shiftDayKey, tomorrowKey } from "@/lib/time";
import { EMPLOYEE_SETTABLE_STATES } from "@/lib/task-board";

const snapshot = (overrides: Partial<TaskSnapshot> = {}): TaskSnapshot => ({
  name: "Review Project Files",
  adminNote: null,
  priority: "MEDIUM",
  dueAt: null,
  scheduledFor: null,
  assigneeId: "emp-1",
  ...overrides,
});

describe("notification preferences", () => {
  it("respects the switch for each type", () => {
    const prefs = { ...DEFAULT_PREFERENCES, taskUpdated: false };
    assert.equal(isTypeEnabled("TASK_ASSIGNED", prefs), true);
    // An employee who turned updates off must not get them.
    assert.equal(isTypeEnabled("TASK_UPDATED", prefs), false);
  });

  it("never silences account-level notifications", () => {
    const off = {
      ...DEFAULT_PREFERENCES,
      taskAssigned: false,
      taskUpdated: false,
      todaySchedule: false,
      tomorrowSchedule: false,
      deadlineReminders: false,
    };
    assert.equal(isTypeEnabled("SYSTEM_NOTIFICATION", off), true);
  });

  it("treats push as a master switch over the per-type ones", () => {
    const prefs = { ...DEFAULT_PREFERENCES, pushEnabled: false };
    // Still recorded in-app, just not sent to devices.
    assert.equal(isTypeEnabled("TASK_ASSIGNED", prefs), true);
    assert.equal(isPushEnabled("TASK_ASSIGNED", prefs), false);
  });
});

describe("idempotency keys", () => {
  it("gives one key per assignment", () => {
    assert.equal(assignedKey("entry-1", "emp-1"), assignedKey("entry-1", "emp-1"));
    assert.notEqual(assignedKey("entry-1", "emp-1"), assignedKey("entry-1", "emp-2"));
  });

  it("keys a daily summary by employee, type and day", () => {
    const first = scheduleKey("TASK_TOMORROW_SCHEDULE", "emp-1", "2026-09-10");
    const rerun = scheduleKey("TASK_TOMORROW_SCHEDULE", "emp-1", "2026-09-10");
    const nextDay = scheduleKey("TASK_TOMORROW_SCHEDULE", "emp-1", "2026-09-11");

    // The job running twice in the same day produces the same key, so the
    // second write is rejected by the unique index.
    assert.equal(first, rerun);
    assert.notEqual(first, nextDay);
  });

  it("gives a moved deadline a new reminder", () => {
    const first = deadlineKey("entry-1", "emp-1", new Date("2026-09-09T12:00:00Z"));
    const moved = deadlineKey("entry-1", "emp-1", new Date("2026-09-09T15:00:00Z"));
    assert.notEqual(first, moved);
    assert.equal(first, deadlineKey("entry-1", "emp-1", new Date("2026-09-09T12:00:00Z")));
  });

  it("dedupes an identical re-save but not a second real edit", () => {
    const before = snapshot();
    const after = snapshot({ priority: "HIGH" });

    const fields = changedFields(before, after);
    const keyOnce = updatedKey("entry-1", "emp-1", revisionStamp(fields, after));
    const keyAgain = updatedKey("entry-1", "emp-1", revisionStamp(changedFields(before, after), after));
    assert.equal(keyOnce, keyAgain);

    const later = snapshot({ priority: "HIGH", adminNote: "Bring the samples" });
    const keyLater = updatedKey("entry-1", "emp-1", revisionStamp(changedFields(after, later), later));
    assert.notEqual(keyOnce, keyLater);
  });
});

describe("change detection", () => {
  it("ignores changes an employee would not care about", () => {
    // Same meaningful values: a status tick or a touched timestamp must not
    // produce an update notification.
    assert.deepEqual(changedFields(snapshot(), snapshot()), []);
  });

  it("names the meaningful fields that moved", () => {
    const fields = changedFields(
      snapshot(),
      snapshot({ dueAt: new Date("2026-09-09T15:00:00Z"), priority: "HIGH" })
    );
    assert.deepEqual(fields.sort(), ["dueAt", "priority"]);
    assert.deepEqual(describeChanges(fields).sort(), ["Deadline", "Priority"]);
  });

  it("compares dates by value, not identity", () => {
    const a = snapshot({ dueAt: new Date("2026-09-09T15:00:00Z") });
    const b = snapshot({ dueAt: new Date("2026-09-09T15:00:00Z") });
    assert.deepEqual(changedFields(a, b), []);
  });
});

describe("notification routing", () => {
  it("sends a task notification to that task's page", () => {
    assert.equal(taskUrl("entry-42"), "/employee/tasks/entry-42");
  });

  it("sends the tomorrow summary to the dashboard's tomorrow view", () => {
    assert.equal(scheduleUrl("tomorrow"), "/employee?day=tomorrow");
    assert.equal(scheduleUrl("today"), "/employee");
  });

  it("carries the click destination in the push payload", () => {
    const payload = pushPayload({
      title: "New Task Assigned",
      message: "You have a new task",
      url: taskUrl("entry-42"),
      type: "TASK_ASSIGNED",
      notificationId: "n1",
    });
    assert.equal(payload.url, "/employee/tasks/entry-42");
    assert.equal(payload.tag, "TASK_ASSIGNED:n1");
  });
});

describe("summary copy", () => {
  it("summarises the day in one notification, not one per task", () => {
    const copy = scheduleCopy("tomorrow", 6);
    assert.equal(copy.title, "Tomorrow's Schedule");
    assert.equal(copy.message, "You have 6 tasks scheduled for tomorrow.");
    assert.equal(scheduleCopy("today", 1).message, "You have 1 task scheduled for today.");
  });
});

describe("push subscription health", () => {
  it("keeps a working subscription and clears its failures", () => {
    const outcome = subscriptionOutcome({ ok: true, statusCode: 201 }, 4);
    assert.deepEqual(outcome, { active: true, failureCount: 0, status: "SENT" });
  });

  it("retires a subscription the browser has dropped", () => {
    for (const statusCode of [404, 410]) {
      const outcome = subscriptionOutcome(
        { ok: false, statusCode, error: "gone", gone: true },
        0
      );
      assert.equal(outcome.active, false, `status ${statusCode} should retire the device`);
      assert.equal(outcome.status, "EXPIRED");
    }
  });

  it("retries a transient failure, but not forever", () => {
    const transient = { ok: false as const, statusCode: 500, error: "server error", gone: false };
    const once = subscriptionOutcome(transient, 0);
    assert.equal(once.active, true);
    assert.equal(once.failureCount, 1);

    const exhausted = subscriptionOutcome(transient, 9);
    assert.equal(exhausted.active, false);
  });
});

describe("timezone handling", () => {
  it("uses the company calendar day, not the server's", () => {
    // 22:30 UTC is already the next day in Amman (UTC+3).
    const instant = new Date("2026-09-09T22:30:00Z");
    assert.equal(dayKeyIn("Asia/Amman", instant), "2026-09-10");
    assert.equal(dayKeyIn("UTC", instant), "2026-09-09");
  });

  it("reads the local hour the 4pm job depends on", () => {
    const instant = new Date("2026-09-09T13:00:00Z");
    assert.equal(hourIn("Asia/Amman", instant), 16);
    assert.equal(hourIn("UTC", instant), 13);
  });

  it("rolls days over month ends", () => {
    assert.equal(shiftDayKey("2026-09-30", 1), "2026-10-01");
    assert.equal(shiftDayKey("2026-01-01", -1), "2025-12-31");
  });

  it("derives tomorrow from the company timezone", () => {
    assert.equal(shiftDayKey(dayKeyIn("Asia/Amman"), 1), tomorrowKey("Asia/Amman"));
  });
});

describe("employee permissions", () => {
  it("lets an employee start work but never declare it finished", () => {
    assert.deepEqual(EMPLOYEE_SETTABLE_STATES, ["TODO", "IN_PROGRESS"]);
    // Completion is the manager approving a photo, so it is not a status
    // anyone can tap their way into.
    assert.equal(EMPLOYEE_SETTABLE_STATES.includes("DONE"), false);
    assert.equal(EMPLOYEE_SETTABLE_STATES.includes("SUBMITTED"), false);
    // TOMORROW is an admin planning marker, not an employee status.
    assert.equal(EMPLOYEE_SETTABLE_STATES.includes("TOMORROW"), false);
  });
});
