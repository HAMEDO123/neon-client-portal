import { test } from "node:test";
import assert from "node:assert/strict";
import { clockWindows, dueClockReminders, anyWindowOpen, type ClockSent } from "../src/lib/clock-reminders";
import { DEFAULT_WORK_HOURS } from "../src/lib/work-hours";

const tz = "Asia/Amman";
const day = "2026-10-04"; // a Sunday — a working day
const hours = { ...DEFAULT_WORK_HOURS, start: "11:00", end: "19:00" };
const windows = clockWindows(hours, day, tz);
const at = (time: string) => new Date(`${day}T${time}:00+03:00`);
const nobody = new Map<string, ClockSent[]>();
const due = (now: string, people: Parameters<typeof dueClockReminders>[0]["people"], sent = nobody) =>
  dueClockReminders({ now: at(now), windows, people, sent }).map((d) => `${d.employeeId}:${d.kind}`);

test("nothing before the day starts, and nothing on a day off", () => {
  assert.deepEqual(due("10:59", [{ id: "a", arrivedAt: null, departedAt: null }]), []);
  assert.equal(clockWindows(hours, "2026-10-02", tz), null); // a Friday
});

test("not seen by the device: 'clock in' from the start, every two minutes", () => {
  const person = [{ id: "a", arrivedAt: null, departedAt: null }];
  assert.deepEqual(due("11:00", person), ["a:in"]);
  const justSent = new Map([["a", [{ kind: "in" as const, lastAt: at("11:00") }]]]);
  assert.deepEqual(due("11:01", person, justSent), []);
  assert.deepEqual(due("11:02", person, justSent), ["a:in"]);
});

test("clocked in: no more 'clock in'", () => {
  assert.deepEqual(due("11:04", [{ id: "a", arrivedAt: at("11:03"), departedAt: null }]), []);
});

test("an hour of chasing, then the manager is told once — not before, not twice", () => {
  const person = [{ id: "a", arrivedAt: null, departedAt: null }];
  const chased = new Map([["a", [{ kind: "in" as const, lastAt: at("11:58") }]]]);
  assert.deepEqual(due("12:00", person, chased), ["a:in-missed"]);
  const told = new Map([["a", [{ kind: "in" as const, lastAt: at("11:58") }, { kind: "in-missed" as const, lastAt: at("12:00") }]]]);
  assert.deepEqual(due("12:30", person, told), []);
});

test("ten minutes before the end, once, to somebody still in", () => {
  const person = [{ id: "a", arrivedAt: at("11:01"), departedAt: null }];
  assert.deepEqual(due("18:49", person), []);
  assert.deepEqual(due("18:50", person), ["a:out-soon"]);
  const warned = new Map([["a", [{ kind: "out-soon" as const, lastAt: at("18:50") }]]]);
  assert.deepEqual(due("18:55", person, warned), []);
});

test("from the end: 'clock out' every two minutes until they do", () => {
  const person = [{ id: "a", arrivedAt: at("11:01"), departedAt: null }];
  assert.deepEqual(due("19:00", person), ["a:out"]);
  const sent = new Map([["a", [{ kind: "out" as const, lastAt: at("19:00") }]]]);
  assert.deepEqual(due("19:01", person, sent), []);
  assert.deepEqual(due("19:02", person, sent), ["a:out"]);
  assert.deepEqual(due("19:02", [{ id: "a", arrivedAt: at("11:01"), departedAt: at("19:01") }], sent), []);
});

test("somebody who never clocked in is not asked to clock out", () => {
  assert.deepEqual(due("19:05", [{ id: "a", arrivedAt: null, departedAt: null }]), []);
});

test("somebody who left early is not chased", () => {
  assert.deepEqual(due("19:00", [{ id: "a", arrivedAt: at("11:01"), departedAt: at("16:00") }]), []);
});

test("the device is only read while a window is open", () => {
  assert.equal(anyWindowOpen(windows, at("10:30")), false);
  assert.equal(anyWindowOpen(windows, at("11:10")), true);
  assert.equal(anyWindowOpen(windows, at("15:00")), false);
  assert.equal(anyWindowOpen(windows, at("18:52")), true);
  assert.equal(anyWindowOpen(windows, at("21:00")), false);
});
