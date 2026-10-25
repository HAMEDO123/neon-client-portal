import { test } from "node:test";
import assert from "node:assert/strict";
import { appendLine, linesOf, REPORT_LIMIT } from "../src/lib/daily-report";

// Written a line at a time from the home screen, into the same text the long
// box on the requests page edits. There is one account of the day.

test("the first line starts the report, the rest are added under it", () => {
  const one = appendLine("", "Took the measurements at Skills", "11:40");
  assert.equal(one, "11:40 — Took the measurements at Skills");

  const two = appendLine(one, "Sent the kitchen drawings", "14:05");
  assert.equal(two, "11:40 — Took the measurements at Skills\n14:05 — Sent the kitchen drawings");
});

test("it joins onto what was written in the long box, whatever shape it is in", () => {
  const typed = "Went to the site in the morning.\n";
  assert.equal(
    appendLine(typed, "The lift was out", "16:20"),
    "Went to the site in the morning.\n16:20 — The lift was out"
  );
});

test("nothing is added for nothing", () => {
  assert.equal(appendLine("11:40 — Something", "   ", "14:00"), "11:40 — Something");
  assert.equal(appendLine("", "", "14:00"), "");
});

test("a day too long to hold loses its oldest words, never the newest", () => {
  const long = "x".repeat(REPORT_LIMIT);
  const after = appendLine(long, "The last thing I did", "18:00");
  assert.equal(after.length, REPORT_LIMIT);
  assert.ok(after.endsWith("18:00 — The last thing I did"), "the newest line survives");
});

test("the lines read back without the empty ones", () => {
  assert.deepEqual(linesOf("11:40 — One\n\n14:05 — Two\n  "), ["11:40 — One", "14:05 — Two"]);
});
