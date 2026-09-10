// Holding to record a voice note, the WhatsApp way, as rules a test can read.
//
// Two bugs lived here. The length of a recording was read from a counter that
// was frozen at zero the moment recording began, so every note looked too
// short and was thrown away on release. And Chrome names its recordings
// "audio/webm;codecs=opus", which the upload check did not recognise as
// audio/webm. Duration now comes from the clock; types are compared without
// their parameters.

/** A press shorter than this is a tap: it shows the hint instead of sending. */
export const MIN_RECORDING_MS = 700;

/** Sliding the finger this far left while holding throws the recording away. */
export const SLIDE_TO_CANCEL_PX = 90;

export type RecordingOutcome = { kind: "send"; seconds: number } | { kind: "too-short" } | { kind: "cancelled" };

export function recordingOutcome(heldMs: number, cancelled: boolean): RecordingOutcome {
  if (cancelled) return { kind: "cancelled" };
  if (!Number.isFinite(heldMs) || heldMs < MIN_RECORDING_MS) return { kind: "too-short" };
  return { kind: "send", seconds: Math.max(1, Math.round(heldMs / 1000)) };
}

// mp4 first: it plays on an iPhone and in Chrome alike, where WebM does not
// reliably play on iOS. An iPhone only records mp4 anyway.
const PREFERRED = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

export function pickAudioType(isSupported: (type: string) => boolean) {
  for (const type of PREFERRED) {
    try {
      if (isSupported(type)) return type;
    } catch {
      // A browser that throws on the question does not support the answer.
    }
  }
  return null;
}

/** "audio/webm;codecs=opus" → "audio/webm". */
export function baseAudioType(mime: string) {
  return mime.split(";")[0].trim().toLowerCase() || "audio/mp4";
}

/** The file extension the server uses to serve the recording back with the right type. */
export function audioExtension(mime: string) {
  const base = baseAudioType(mime);
  if (base.includes("mp4") || base.includes("aac") || base.includes("m4a")) return "m4a";
  if (base.includes("ogg")) return "ogg";
  if (base.includes("mpeg")) return "mp3";
  return "webm";
}

export function formatDuration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
