import type { ChatViewer, Conversation } from "@/lib/chat-conversations";

// Calls in a conversation, as rules: who is in one, how long it rings, when
// somebody who stopped answering has left, when a call is over and what it
// says in the chat afterwards, how the call screen lays out its people, who is
// speaking, how good a connection is, and which of two devices starts talking
// first. Pure and tested; the database side is call-store.ts, the browser
// side components/calls/.
//
// The sound and pictures go straight between the devices in the call. The
// server only introduces them and keeps count of who is there.

export type CallKind = "AUDIO" | "VIDEO";
export type CallStatus = "RINGING" | "ACTIVE" | "ENDED";
export type ParticipantState = "INVITED" | "JOINED" | "LEFT" | "DECLINED";
export type EndReason = "completed" | "missed" | "declined";

/** How long a call rings before it counts as missed. */
export const RING_MS = 45_000;
/** How long somebody in a call can go unseen before they count as gone: a closed tab, a phone that lost its signal. */
export const STALE_MS = 20_000;
/** How often an open call tells the server it is still there. */
export const HEARTBEAT_MS = 5_000;

/** A person in calls: "admin" for the manager, their employee id otherwise — the same key chat reads use. */
export function memberKeyOf(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? "admin" : viewer.id;
}

/**
 * Where calls can be made: every conversation. A call in the team's group rings
 * everybody on the team and carries on while anybody is in it; a call in a
 * private chat is between its two people.
 */
export function mayCallIn(conversation: Conversation) {
  return conversation.kind === "team" || conversation.kind === "direct" || conversation.kind === "peer";
}

function time(value: Date | string) {
  return new Date(value).getTime();
}

export type SweepInput = {
  status: CallStatus;
  createdAt: Date | string;
  startedByKey: string;
  /** A group call keeps going while anybody is in it; a call between two ends when either leaves. */
  group: boolean;
  participants: { memberKey: string; state: ParticipantState; lastSeenAt: Date | string | null }[];
};

/**
 * What a ringing or running call has become, looked at now: who in it has
 * gone quiet for too long and should count as having left, and whether the
 * call is over and why.
 *
 * Ringing: missed when the caller is gone before anybody answered, or nobody
 * answered in time; declined when everybody asked said no. Running: over when
 * nobody is left — or, between two people, when either of them is.
 */
export function sweepCall(call: SweepInput, now: number): { gone: string[]; end: EndReason | null } {
  if (call.status === "ENDED") return { gone: [], end: null };

  // No heartbeat yet is somebody still arriving, not somebody gone.
  const gone = call.participants
    .filter((part) => part.state === "JOINED" && part.lastSeenAt != null && now - time(part.lastSeenAt) > STALE_MS)
    .map((part) => part.memberKey);
  const inCall = call.participants.filter((part) => part.state === "JOINED" && !gone.includes(part.memberKey));

  if (call.status === "RINGING") {
    const asked = call.participants.filter((part) => part.memberKey !== call.startedByKey);
    if (inCall.length === 0) return { gone, end: "missed" };
    if (asked.length > 0 && asked.every((part) => part.state === "DECLINED")) return { gone, end: "declined" };
    if (now - time(call.createdAt) > RING_MS) return { gone, end: "missed" };
    return { gone, end: null };
  }

  const enough = call.group ? inCall.length >= 1 : inCall.length >= 2;
  return { gone, end: enough ? null : "completed" };
}

/** Whether this person's phone should be ringing for a call: asked, not yet answered, and still in time. */
export function ringsFor(
  call: { status: CallStatus; createdAt: Date | string },
  state: ParticipantState | undefined,
  now: number
) {
  return call.status !== "ENDED" && state === "INVITED" && now - time(call.createdAt) < RING_MS;
}

/** "0:45", "4:32", "1:02:05". */
export function callDuration(seconds: number) {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/** The line a finished call leaves in the conversation. */
export function callSummary(kind: CallKind, reason: EndReason, seconds: number | null) {
  const video = kind === "VIDEO";
  if (reason === "missed") return video ? "Missed video call" : "Missed call";
  if (reason === "declined") return video ? "Declined video call" : "Declined call";
  return `${video ? "Video call" : "Call"} ended · ${callDuration(seconds ?? 0)}`;
}

/**
 * Of two devices in a call, the one that makes the first offer: whoever
 * joined later calls those already there, and a tie goes to the larger key.
 * The other waits to be called, so the two never both offer at once to start.
 */
export function initiates(me: { key: string; joinedAt: Date | string }, other: { key: string; joinedAt: Date | string }) {
  const mine = time(me.joinedAt);
  const theirs = time(other.joinedAt);
  return mine === theirs ? me.key > other.key : mine > theirs;
}

/**
 * When both devices do renegotiate at once — a camera switched on at the same
 * moment as a screen share — one yields. "Perfect negotiation": the polite one
 * drops its own offer and takes the other's.
 */
export function isPolite(myKey: string, otherKey: string) {
  return myKey < otherKey;
}

/**
 * Columns and rows for a grid of people: one fills the screen, two sit side
 * by side (one above the other on a phone), three and four make a two-by-two,
 * five and six three-by-two (two-by-three on a phone), then three or four wide.
 */
export function gridFor(count: number, narrow: boolean): { columns: number; rows: number } {
  if (count <= 1) return { columns: 1, rows: 1 };
  if (count === 2) return narrow ? { columns: 1, rows: 2 } : { columns: 2, rows: 1 };
  if (count <= 4) return { columns: 2, rows: 2 };
  if (count <= 6) return narrow ? { columns: 2, rows: 3 } : { columns: 3, rows: 2 };
  if (count <= 9) return { columns: 3, rows: 3 };
  const columns = narrow ? 3 : 4;
  return { columns, rows: Math.ceil(count / columns) };
}

/** Loud enough to count as speaking, with a lower bar to stop: a word's quiet end does not flicker the ring. */
export function isSpeaking(level: number, wasSpeaking: boolean) {
  return wasSpeaking ? level > 0.02 : level > 0.045;
}

/**
 * Who to show large: whoever is loudest now, but only once the person shown
 * has held the stage for a moment, so two people talking over each other do
 * not make the view flick back and forth.
 */
export function nextSpeaker(
  current: { key: string | null; since: number },
  levels: Record<string, number>,
  now: number,
  holdMs = 1500
): { key: string | null; since: number } {
  let loudest: string | null = null;
  let top = 0.045;
  for (const [key, level] of Object.entries(levels)) {
    if (level > top) {
      top = level;
      loudest = key;
    }
  }

  if (!loudest || loudest === current.key) return current;
  if (current.key && now - current.since < holdMs) return current;
  return { key: loudest, since: now };
}

export type Quality = "good" | "fair" | "poor" | "unknown";

/** How a connection is doing, from the round trip, the share of packets lost and the jitter. */
export function qualityOf(sample: { rttMs: number | null; lossRatio: number | null; jitterMs: number | null }): Quality {
  const { rttMs, lossRatio, jitterMs } = sample;
  if (rttMs == null && lossRatio == null && jitterMs == null) return "unknown";
  if ((rttMs ?? 0) > 400 || (lossRatio ?? 0) > 0.08 || (jitterMs ?? 0) > 60) return "poor";
  if ((rttMs ?? 0) > 200 || (lossRatio ?? 0) > 0.03 || (jitterMs ?? 0) > 30) return "fair";
  return "good";
}

export type IceServer = { urls: string | string[]; username?: string; credential?: string };

/**
 * The servers a device may use to find a way through, from Cloudflare's
 * answer — without the port 53 addresses, which browsers block and which only
 * make a connection wait for them to time out.
 */
export function usableIceServers(response: unknown): IceServer[] {
  const list = (response as { iceServers?: unknown } | null)?.iceServers;
  if (!Array.isArray(list)) return [];

  return list.flatMap((entry): IceServer[] => {
    const server = entry as { urls?: unknown; username?: unknown; credential?: unknown };
    const urls = (Array.isArray(server.urls) ? server.urls : [server.urls])
      .filter((url): url is string => typeof url === "string" && /^(stun|turns?):/.test(url))
      .filter((url) => !/:53(\?|$)/.test(url));
    if (urls.length === 0) return [];
    return [
      {
        urls,
        ...(typeof server.username === "string" ? { username: server.username } : {}),
        ...(typeof server.credential === "string" ? { credential: server.credential } : {}),
      },
    ];
  });
}
