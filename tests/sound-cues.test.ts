import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CUES, isNews, type Cue } from "../src/lib/sound-cues";

const length = (cue: Cue) => Math.max(...CUES[cue].map((note) => note.start + note.duration));

describe("the two sounds", () => {
  it("are not the same sound", () => {
    assert.notDeepEqual(CUES.message, CUES.update);
    assert.notEqual(CUES.message[0].frequency, CUES.update[0].frequency);
  });

  it("are short and gentle", () => {
    for (const cue of ["message", "update"] as const) {
      assert.ok(length(cue) < 1, `${cue} lasts under a second`);
      assert.ok(CUES[cue].every((note) => note.level > 0 && note.level <= 0.3), `${cue} is quiet`);
    }
  });

  it("can be told apart by ear: the message is quick and high, the update long and low", () => {
    assert.ok(length("message") < length("update"));
    assert.ok(CUES.message[0].frequency > CUES.update[0].frequency);
  });
});

describe("hearing each thing once", () => {
  it("counts something as news only when it is newer than what was heard", () => {
    assert.equal(isNews(0, 1_000), true);
    assert.equal(isNews(1_000, 1_000), false);
    assert.equal(isNews(2_000, 1_000), false);
  });
});
