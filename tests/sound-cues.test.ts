import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { CUES, isNews, type Cue } from "../src/lib/sound-cues";

const length = (cue: Cue) => Math.max(...CUES[cue].map((note) => note.start + note.duration));
const peak = (cue: Cue) => Math.max(...CUES[cue].map((note) => note.level));

describe("the two sounds", () => {
  it("are not the same sound", () => {
    assert.notDeepEqual(CUES.message, CUES.update);
    assert.notEqual(CUES.message[0].frequency, CUES.update[0].frequency);
  });

  it("are short", () => {
    for (const cue of ["message", "update"] as const) assert.ok(length(cue) < 1, `${cue} lasts under a second`);
  });

  it("are loud enough for a phone's speaker, and never past full scale", () => {
    for (const cue of ["message", "update"] as const) {
      assert.ok(CUES[cue].every((note) => note.level > 0 && note.level <= 1), `${cue} stays within range`);
    }
    assert.ok(peak("message") >= 0.5, "the message sound is near full volume");
  });

  it("make the message the louder and the more distinctive: three notes climbing", () => {
    assert.ok(peak("message") > peak("update"));
    const notes = CUES.message.map((note) => note.frequency);
    assert.equal(notes.length, 3);
    assert.ok(notes[0] < notes[1] && notes[1] < notes[2], "each note higher than the last");
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
