// The studio's walkie-talkie: press, choose somebody — or everybody — speak,
// and it is heard on their phones at once, locked or not, without them
// touching anything. The manager and the team alike can talk, to each other.
//
// The studio made it required (2026-10-25): everybody on the team allows it
// once, and the app covers its screens until they have. It is still their
// phone's own yes — Apple's Push to Talk asks it of the person, never of the
// server — and it speaks only inside its own hours, 10:00 to 19:00 in the
// studio's clock, every day (`walkieHoursOpen`; the studio set them on
// 2026-10-25). Outside them nothing is sent at all. Turning it on joins
// Apple's Push to Talk channel on that phone, which is what hands the server a
// PTT token (DeviceToken kind PTT); leaving it retires the token. So "can this
// phone be talked to" is exactly "does it have a live PTT token" — one fact,
// kept by the phone's owner, with no second switch to drift.
//
// What is said is recorded on the speaker's phone and sent whole when the
// button is let go: a few seconds behind, and never a half-heard sentence on a
// bad connection. Pure: the payload the phone reads.

/** When the walkie-talkie speaks, in the studio's wall clock: from 10:00 until 19:00. */
export const WALKIE_FROM = "10:00";
export const WALKIE_UNTIL = "19:00";

function minutesOf(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * Whether a wall-clock time ("HH:MM", the studio's) is inside the hours.
 * The hours run across midnight, so it is "after the start OR before the end".
 */
export function walkieHoursOpen(wallClock: string, from = WALKIE_FROM, until = WALKIE_UNTIL) {
  const now = minutesOf(wallClock);
  const start = minutesOf(from);
  const end = minutesOf(until);
  return start <= end ? now >= start && now < end : now >= start || now < end;
}

/** The longest thing one press may say, in seconds — a walkie-talkie, not a voice note. */
export const WALKIE_MAX_SECONDS = 60;

export type WalkiePayload = {
  /** What iOS shows as who is talking. */
  activeSpeaker: string;
  neon: { kind: "walkie"; id: string; audioUrl: string; seconds: number | null; from: string };
};

/** What the phone is woken with: everything it needs to play, so playing waits on nothing else. */
export function walkiePayload(input: { id: string; audioUrl: string; seconds: number | null; fromName: string }): WalkiePayload {
  return {
    activeSpeaker: input.fromName,
    neon: { kind: "walkie", id: input.id, audioUrl: input.audioUrl, seconds: input.seconds, from: input.fromName },
  };
}

/** Who one press goes to: everybody, the manager ("admin"), or one person on the team. */
export type WalkieTarget = { kind: "all" } | { kind: "manager" } | { kind: "person"; id: string };

export function readWalkieTarget(value: unknown): WalkieTarget | null {
  if (value === "all") return { kind: "all" };
  if (value === "admin") return { kind: "manager" };
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,40}$/.test(value) ? { kind: "person", id: value } : null;
}

/** A length the phone sent, or null: whole seconds, never beyond the limit. */
export function readWalkieSeconds(value: unknown): number | null {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.min(WALKIE_MAX_SECONDS, Math.max(1, Math.round(seconds)));
}
