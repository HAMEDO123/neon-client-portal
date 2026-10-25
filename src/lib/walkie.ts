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

/**
 * The walkie-talkie's own hours, in the studio's wall clock.
 *
 * Not opening and closing times any more: it runs around the clock. These are
 * the hours it is a room everybody is in — outside them it is a line between
 * two people (`walkiePressAllowed`).
 */
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

/** Somebody at one end of a press: whether the studio allows them at night. */
export type WalkieWho = { late: boolean };

/**
 * Whether a press may go out now, and why not when it may not.
 *
 * The hours no longer close the walkie-talkie — it runs all day. What they
 * decide is how wide it is. Inside 10:00–19:00 anybody talks to anybody, and
 * to everybody at once. Outside them it narrows to a line between two people:
 * one speaker, one listener, and both ends somebody the studio allows at
 * night. Nobody else hears it, and nobody else can start one.
 *
 * The manager is not one of them. The studio asked for the night to be those
 * two and nobody else, so it is closed to the manager as much as to anybody
 * else: there is no press they can make and none they can be sent.
 *
 * Pure, because this is the rule itself: the store does the reading and the
 * sending, and the rule can be read here without either.
 */
export function walkiePressAllowed(input: {
  /** The studio's wall clock, "HH:MM". */
  wallClock: string;
  speaker: WalkieWho;
  target: WalkieTarget;
  /** The person being spoken to, when the target is one of the team. */
  listener?: WalkieWho;
}): { ok: true } | { ok: false; reason: "night-all" | "night-speaker" | "night-listener" } {
  if (walkieHoursOpen(input.wallClock)) return { ok: true };

  // At night it is a line between two people, never a room.
  if (input.target.kind === "all") return { ok: false, reason: "night-all" };

  if (!input.speaker.late) return { ok: false, reason: "night-speaker" };

  // Both ends, and the manager is not an end: at night the only line that
  // exists is between the people the studio allows at night.
  if (input.target.kind === "manager") return { ok: false, reason: "night-listener" };
  if (!input.listener?.late) return { ok: false, reason: "night-listener" };

  return { ok: true };
}

/** The longest thing one press may say, in seconds — a walkie-talkie, not a voice note. */
export const WALKIE_MAX_SECONDS = 60;

export type WalkiePayload = {
  /** What iOS shows as who is talking. */
  activeSpeaker: string;
  neon: { kind: "walkie"; id: string; audioUrl: string; seconds: number | null; from: string; fromKey: string; scope: "one" | "all" };
};

/** What the phone is woken with: everything it needs to play, so playing waits on nothing else. */
export function walkiePayload(input: {
  id: string;
  audioUrl: string;
  seconds: number | null;
  fromName: string;
  fromKey: string;
  scope: "one" | "all";
}): WalkiePayload {
  return {
    activeSpeaker: input.fromName,
    neon: {
      kind: "walkie",
      id: input.id,
      audioUrl: input.audioUrl,
      seconds: input.seconds,
      from: input.fromName,
      fromKey: input.fromKey,
      scope: input.scope,
    },
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
