import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { needsTranscode, playableVoice, readSeconds } from "../src/lib/voice-transcode";

test("what an iPhone plays is left alone; Ogg and WebM are converted", () => {
  assert.equal(needsTranscode("audio/mp4"), false);
  assert.equal(needsTranscode("audio/mpeg"), false);
  assert.equal(needsTranscode("audio/x-m4a"), false);
  assert.equal(needsTranscode("audio/ogg; codecs=opus"), true);
  assert.equal(needsTranscode("audio/webm;codecs=opus"), true);
  assert.equal(needsTranscode("audio/opus"), true);
  assert.equal(needsTranscode("video/webm"), true);
});

test("a length is whole seconds, at least one, or nothing", () => {
  assert.equal(readSeconds("12.6\n"), 13);
  assert.equal(readSeconds("0.3"), 1);
  assert.equal(readSeconds("N/A"), null);
  assert.equal(readSeconds(""), null);
});

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("a WhatsApp-style Ogg Opus note becomes an m4a with its length", { skip: !hasFfmpeg && "no ffmpeg here" }, async () => {
  const folder = mkdtempSync(path.join(tmpdir(), "voice-test-"));
  try {
    const opus = path.join(folder, "note.opus");
    const made = spawnSync("ffmpeg", ["-loglevel", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:a", "libopus", opus]);
    if (made.status !== 0) return; // an ffmpeg built without libopus: nothing to test with
    const file = new File([readFileSync(opus)], "WhatsApp Audio.opus", { type: "audio/ogg" });
    const result = await playableVoice(file);
    assert.equal(result.file.type, "audio/mp4");
    assert.equal(result.file.name, "WhatsApp Audio.m4a");
    assert.equal(result.seconds, 2);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
