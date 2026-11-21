import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { employeeStateLabel, isSentBack } from "../src/lib/task-board";

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

// The owner, 2026-11-21: "show a text saying rejected in the app and do not
// show what was its status before rejecting it".
describe("a job sent back reads Rejected", () => {
  it("while its latest hand-in was rejected and it is not handed in again", () => {
    assert.equal(isSentBack("IN_PROGRESS", "REJECTED"), true);
    assert.equal(isSentBack("TODO", "REJECTED"), true);
    assert.equal(isSentBack("SUBMITTED", "PENDING"), false, "handed in again");
    assert.equal(isSentBack("DONE", "APPROVED"), false);
    assert.equal(isSentBack("IN_PROGRESS", null), false, "never handed in");
  });

  it("says Rejected in place of its state", () => {
    assert.equal(employeeStateLabel("IN_PROGRESS", true), "Rejected");
    assert.equal(employeeStateLabel("IN_PROGRESS", false), "In progress");
  });

  it("is what the website and the phone show", () => {
    const card = read("src", "components", "employee", "assigned-task-card.tsx");
    assert.match(card, /employeeStateLabel\(task\.state, task\.sentBack\)/);
    const detail = read("src", "components", "employee", "assigned-task-detail.tsx");
    assert.match(detail, /employeeStateLabel\(task\.state, task\.sentBack\)/);
    const phone = read("src", "lib", "mobile", "registry", "me.ts");
    assert.match(phone, /state: job\.sentBack \? "REJECTED" : job\.state/);
    assert.match(phone, /jobs: filtered\.map\(onPhone\)/);
    assert.match(phone, /job: onPhone\(job\)/);
    const ios = read("ios", "Sources", "Core", "Formatting.swift");
    assert.match(ios, /case "REJECTED": return L\("Rejected"\)/);
    assert.match(read("ios", "Resources", "ar.lproj", "Localizable.strings"), /"Rejected" = "مرفوض";/);
  });

  // Due again before 12 AM the day it was sent back; sent back after the
  // 10:59 PM warning, the rejection is the warning, so the charge still lands.
  it("warns somebody sent back after the evening warning", () => {
    const actions = read("src", "lib", "actions", "submission-actions.ts");
    assert.match(actions, />= WARN_MINUTES\) \{\s*await dispatchNotification\(\{\s*employeeId,\s*type: "WARNING",\s*\.\.\.warningCopy\(1\)/);
    assert.match(actions, /dedupeKey: warningKey\(employeeId, todayKey\)/);
  });
});
