// Two sounds the app makes while it is open: one when a message arrives, and a
// different one for everything else — a task, a review, a request.
//
// Only while it is open. A notification that arrives with the app closed is
// shown by the phone, and the phone plays its own sound for it: a web app
// cannot choose that sound, on an iPhone or on Android.
//
// Synthesised rather than loaded: nothing to fetch, nothing to license, and it
// plays the instant it is asked. Browsers only let a page make sound once
// somebody has touched it, so the first tap anywhere switches sound on.

export type Cue = "message" | "update";

export type Note = { frequency: number; start: number; duration: number; wave: OscillatorType; level: number };

/** The notes of each sound, in seconds from its start. */
export const CUES: Record<Cue, Note[]> = {
  // A quick rising pair, like a bubble landing.
  message: [
    { frequency: 880, start: 0, duration: 0.09, wave: "sine", level: 0.22 },
    { frequency: 1318.5, start: 0.085, duration: 0.16, wave: "sine", level: 0.2 },
  ],
  // Lower, softer and longer: a two-tone chime, for everything that is not a message.
  update: [
    { frequency: 659.25, start: 0, duration: 0.45, wave: "triangle", level: 0.22 },
    { frequency: 987.77, start: 0.15, duration: 0.6, wave: "triangle", level: 0.18 },
  ],
};

/**
 * Whether something that happened at `at` is news, given the newest of its
 * kind already heard. A message is heard once however many parts of the app
 * report it — the open chat and the heartbeat both do.
 */
export function isNews(heardUpTo: number, at: number) {
  return at > heardUpTo;
}

const OFF_KEY = "neon:sounds";
const heard: Record<Cue, number> = { message: 0, update: 0 };
let context: AudioContext | null = null;

/** On unless this device was told otherwise. A device setting, like a phone's own volume. */
export function soundsOn() {
  try {
    return window.localStorage.getItem(OFF_KEY) !== "off";
  } catch {
    return true;
  }
}

const SWITCHED = "neon:sounds-switched";

export function setSoundsOn(on: boolean) {
  try {
    if (on) window.localStorage.removeItem(OFF_KEY);
    else window.localStorage.setItem(OFF_KEY, "off");
  } catch {
    // Private browsing: the switch lasts as long as the page.
  }
  window.dispatchEvent(new Event(SWITCHED));
}

/** For useSyncExternalStore: the switch here, or in another tab of the same app. */
export function subscribeSounds(onChange: () => void) {
  window.addEventListener(SWITCHED, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(SWITCHED, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/** Call from a tap or a key press, the only moment a browser allows sound to start. */
export function unlockSounds(): Promise<void> {
  try {
    const Context =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return Promise.resolve();
    context ??= new Context();
    // An iPhone suspends it again when the app goes to the background.
    if (context.state !== "running") return context.resume().catch(() => undefined);
  } catch {
    // No sound on this device.
  }
  return Promise.resolve();
}

/** Where hearing starts: whatever had already happened when a screen opened is not news. */
export function markHeard(cue: Cue, at: number) {
  heard[cue] = Math.max(heard[cue], at);
}

/** Plays `cue` for something that happened at `at`, once. Returns whether it was news. */
export function playCue(cue: Cue, at: number) {
  if (!isNews(heard[cue], at)) return false;
  heard[cue] = at;
  if (soundsOn() && document.visibilityState === "visible") sound(cue);
  return true;
}

/** Plays a sound now, whatever has been heard: for trying them out. */
export function previewCue(cue: Cue) {
  void unlockSounds().then(() => sound(cue));
}

function sound(cue: Cue) {
  if (!context || context.state !== "running") return;
  const now = context.currentTime + 0.02;

  for (const note of CUES[cue]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = now + note.start;

    oscillator.type = note.wave;
    oscillator.frequency.setValueAtTime(note.frequency, start);
    // A fast rise and an even fall, so each note sounds struck, not switched on.
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(note.level, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + note.duration);

    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + note.duration + 0.05);
  }
}
