import { test } from "node:test";
import assert from "node:assert/strict";
import { ringPayload } from "../src/lib/call-ring";

// The app (ios/Sources/Features/Calls) parses exactly these keys; changing one
// silently turns a ringing phone back into a silent one.

test("a private call shows the caller", () => {
  assert.deepEqual(
    ringPayload({ callId: "c1", callerName: "Sally", kind: "AUDIO", conversation: { kind: "direct", employeeId: "e1" } }),
    { type: "incoming-call", callId: "c1", callerName: "Sally", title: "Sally", kind: "AUDIO", isGroup: false }
  );
});

test("a team or group call shows where it is", () => {
  const team = ringPayload({ callId: "c2", callerName: "Wael", kind: "VIDEO", conversation: { kind: "team" }, groupName: "NEON Team" });
  assert.equal(team.title, "NEON Team");
  assert.equal(team.isGroup, true);

  const group = ringPayload({ callId: "c3", callerName: "Wael", kind: "AUDIO", conversation: { kind: "group", groupId: "g1" }, groupName: "  Site crew " });
  assert.equal(group.title, "Site crew");

  const unnamed = ringPayload({ callId: "c4", callerName: "Wael", kind: "AUDIO", conversation: { kind: "group", groupId: "g1" }, groupName: null });
  assert.equal(unnamed.title, "Group call");
});
