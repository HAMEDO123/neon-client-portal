import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  audioExtension,
  baseAudioType,
  formatDuration,
  MIN_RECORDING_MS,
  pickAudioType,
  recordingOutcome,
} from "../src/lib/voice";

describe("letting go of the mic", () => {
  it("sends what was recorded, timed by the clock", () => {
    // The bug: the length came from a counter frozen at zero, so every note
    // was "too short" and thrown away on release.
    assert.deepEqual(recordingOutcome(4200, false), { kind: "send", seconds: 4 });
    assert.deepEqual(recordingOutcome(1200, false), { kind: "send", seconds: 1 });
  });

  it("treats a tap as a tap, and shows the hint instead", () => {
    assert.deepEqual(recordingOutcome(MIN_RECORDING_MS - 1, false), { kind: "too-short" });
    assert.deepEqual(recordingOutcome(0, false), { kind: "too-short" });
  });

  it("throws the recording away when the finger slides off to cancel", () => {
    assert.deepEqual(recordingOutcome(6000, true), { kind: "cancelled" });
  });

  it("never sends a nonsense length", () => {
    assert.deepEqual(recordingOutcome(Number.NaN, false), { kind: "too-short" });
  });
});

describe("the recording's format", () => {
  it("records mp4 on an iPhone, which is all it offers", () => {
    assert.equal(pickAudioType((type) => type === "audio/mp4"), "audio/mp4");
  });

  it("prefers mp4 where both exist, so the note plays on an iPhone too", () => {
    assert.equal(pickAudioType(() => true), "audio/mp4");
  });

  it("falls back to WebM where mp4 is not offered", () => {
    assert.equal(pickAudioType((type) => type.startsWith("audio/webm")), "audio/webm;codecs=opus");
  });

  it("reports nothing when the browser offers nothing, or throws", () => {
    assert.equal(pickAudioType(() => false), null);
    assert.equal(
      pickAudioType(() => {
        throw new Error("no");
      }),
      null
    );
  });

  it("reads Chrome's recording type as the audio/webm it is", () => {
    assert.equal(baseAudioType("audio/webm;codecs=opus"), "audio/webm");
    assert.equal(baseAudioType(" Audio/MP4 "), "audio/mp4");
  });

  it("names the file so it is served back with the right type", () => {
    assert.equal(audioExtension("audio/mp4"), "m4a");
    assert.equal(audioExtension("audio/webm;codecs=opus"), "webm");
    assert.equal(audioExtension("audio/ogg;codecs=opus"), "ogg");
  });
});

describe("the timer while recording", () => {
  it("reads minutes and seconds", () => {
    assert.equal(formatDuration(7), "0:07");
    assert.equal(formatDuration(75), "1:15");
    assert.equal(formatDuration(-3), "0:00");
  });
});
