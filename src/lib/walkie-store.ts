import { prisma } from "@/lib/db";
import { managerEmployeeId } from "@/lib/manager-account";
import { deviceOutcome, isApnsConfigured, sendPushToTalk } from "@/lib/notifications/apns";
import { getTimezone } from "@/lib/settings";
import { saveFile } from "@/lib/storage";
import { wallClockIn } from "@/lib/time";
import { voiceFor } from "@/lib/walkie-voice";
import { walkieHoursOpen, walkiePayload, walkiePressAllowed, type WalkieTarget } from "@/lib/walkie";

// The database and delivery side of the walkie-talkie (lib/walkie.ts has the
// why). Deliberately not "use server": these trust their caller to have
// resolved who is asking.

/** Who is talking: the manager, or somebody on the team. */
export type WalkieSpeaker = { type: "ADMIN" } | { type: "EMPLOYEE"; id: string; name: string };

/** Whether this is one of the hours the walkie-talkie is a room everybody is in. */
export async function walkieOpen(now = new Date()) {
  const timeZone = await getTimezone();
  return walkieHoursOpen(wallClockIn(timeZone, now));
}

/**
 * Whether it is open to THIS person right now.
 *
 * It runs around the clock, but outside 10:00–19:00 only the people the studio
 * allows at night can use it — the manager included in "everybody else". So
 * "open" is a different answer for Wael at midnight than for anybody else, and
 * the app asking should get their own rather than the studio's.
 */
export async function walkieOpenForSpeaker(speaker: WalkieSpeaker, now = new Date()) {
  if (await walkieOpen(now)) return true;
  if (speaker.type === "ADMIN") return false;
  const row = await prisma.employee.findUnique({ where: { id: speaker.id }, select: { walkieLate: true } });
  return row?.walkieLate === true;
}

/** How the app names a speaker: "admin" for the manager, an employee's id otherwise. */
export function speakerKey(speaker: WalkieSpeaker) {
  return speaker.type === "ADMIN" ? "admin" : speaker.id;
}

/** The phone's own row: the employee's, or the manager's (null when there is none). */
export async function speakerRow(speaker: WalkieSpeaker) {
  return speaker.type === "EMPLOYEE" ? speaker.id : await managerEmployeeId();
}

/**
 * Everybody the speaker can talk to — the manager (as "admin") and the team,
 * never themselves — each with whether they have it on.
 */
export async function walkiePeople(speaker: WalkieSpeaker) {
  const managerRow = await managerEmployeeId();
  const rows = await prisma.employee.findMany({
    where: { active: true, OR: [{ accessRole: "EMPLOYEE" }, ...(managerRow ? [{ id: managerRow }] : [])] },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      role: true,
      photoUrl: true,
      deviceTokens: { where: { active: true, kind: "PTT" }, select: { id: true } },
    },
  });
  const self = await speakerRow(speaker);
  return rows
    .filter((row) => row.id !== self)
    .map((row) => ({
      id: row.id === managerRow ? "admin" : row.id,
      name: row.id === managerRow ? "The manager" : row.name,
      role: row.role,
      photoUrl: row.photoUrl,
      manager: row.id === managerRow,
      allowed: row.deviceTokens.length > 0,
    }))
    .sort((a, b) => Number(b.manager) - Number(a.manager));
}

/** Whether this phone's owner has it on, on any of their phones. */
export async function walkieAllowed(employeeId: string | null) {
  if (!employeeId) return false;
  const count = await prisma.deviceToken.count({ where: { employeeId, active: true, kind: "PTT" } });
  return count > 0;
}

/** Turned off on a phone (by iOS, or signing out): its walkie-talkie token is retired. */
export async function leaveWalkie(employeeId: string, token: string | null) {
  await prisma.deviceToken.updateMany({
    where: { employeeId, kind: "PTT", ...(token ? { token } : {}) },
    data: { active: false },
  });
}

export type WalkieOutcome =
  | { ok: true; batch: string; heard: string[]; notOn: string[]; phones: number }
  | {
      ok: false;
      reason: "night-all" | "night-speaker" | "night-listener" | "not-found" | "nobody" | "no-push";
      names?: string[];
    };

/**
 * Says it: stores the voice once, writes a row for each person it goes to, and
 * wakes every phone of theirs with the walkie-talkie on. `heard` is who had a
 * phone Apple took it for and `notOn` who has not turned it on — said to the
 * speaker as they are, because "sent" to a phone that heard nothing is the one
 * thing this must never claim.
 */
export async function sayOnWalkie(input: {
  speaker: WalkieSpeaker;
  target: WalkieTarget;
  voice: File;
  seconds: number | null;
}): Promise<WalkieOutcome> {
  if (!isApnsConfigured()) return { ok: false, reason: "no-push" };

  // Who is talking, as the rule reads it. The hours no longer close the
  // walkie-talkie; outside them they narrow it to two people (lib/walkie.ts).
  const timeZone = await getTimezone();
  const wallClock = wallClockIn(timeZone, new Date());
  const speakerLate =
    input.speaker.type === "EMPLOYEE"
      ? (await prisma.employee.findUnique({ where: { id: input.speaker.id }, select: { walkieLate: true } }))
          ?.walkieLate === true
      : false;
  const speaking = { late: speakerLate };

  // Refused before the recording is read or stored: nothing is kept for a
  // press that was never allowed to leave the phone.
  if (input.target.kind === "all" || input.target.kind === "manager") {
    const early = walkiePressAllowed({ wallClock, speaker: speaking, target: input.target });
    if (!early.ok) return { ok: false, reason: early.reason };
  }

  const managerRow = await managerEmployeeId();
  const self = await speakerRow(input.speaker);
  const recipients = await prisma.employee.findMany({
    where: {
      active: true,
      ...(input.target.kind === "all"
        ? { OR: [{ accessRole: "EMPLOYEE" }, ...(managerRow ? [{ id: managerRow }] : [])] }
        : input.target.kind === "manager"
          ? { id: managerRow ?? "-" }
          : { id: input.target.id, accessRole: "EMPLOYEE" }),
      ...(self ? { NOT: { id: self } } : {}),
    },
    select: { id: true, name: true, walkieLate: true, deviceTokens: { where: { active: true, kind: "PTT" } } },
  });
  if (recipients.length === 0) return { ok: false, reason: "not-found" };

  // Talking to one of the team at night needs them to be allowed at night too.
  if (input.target.kind === "person") {
    const them = recipients[0];
    const verdict = walkiePressAllowed({
      wallClock,
      speaker: speaking,
      target: input.target,
      listener: { late: them.walkieLate },
    });
    if (!verdict.ok) return { ok: false, reason: verdict.reason };
  }

  const listening = recipients.filter((person) => person.deviceTokens.length > 0);
  const notOn = recipients.filter((person) => person.deviceTokens.length === 0).map((person) => (person.id === managerRow ? "The manager" : person.name));
  if (listening.length === 0) return { ok: false, reason: "nobody", names: notOn };

  const fromName = input.speaker.type === "ADMIN" ? "The manager" : input.speaker.name;
  const fromKey = speakerKey(input.speaker);
  const scope = input.target.kind === "all" ? "all" : "one";
  // One press, one batch: what a conversation shows as a single message.
  const batch = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const prepared = await voiceFor(input.voice);
  const saved = await saveFile(prepared.file, "walkie", "audio", false);
  const seconds = input.seconds ?? prepared.seconds;

  const heard: string[] = [];
  let phones = 0;
  for (const person of listening) {
    const toKey = person.id === managerRow ? "admin" : person.id;
    const message = await prisma.walkieMessage.create({
      data: { employeeId: person.id, fromName, fromKey, toKey, scope, batch, audioUrl: saved.url, seconds },
    });
    const payload = walkiePayload({ id: message.id, audioUrl: saved.url, seconds, fromName, fromKey, scope });
    let theirs = 0;
    for (const device of person.deviceTokens) {
      const result = await sendPushToTalk({ token: device.token, bundleId: device.bundleId, sandbox: device.sandbox }, payload);
      if (result.ok) theirs += 1;
      // "TopicDisallowed" means the APNs key does not cover <bundle>.voip-ptt.
      else console.warn(`[walkie] ${device.id}: ${result.statusCode ?? "no status"} ${result.error}`);
      const outcome = deviceOutcome(result, device.failureCount);
      await prisma.deviceToken
        .update({
          where: { id: device.id },
          data: { active: outcome.active, failureCount: outcome.failureCount, lastUsedAt: result.ok ? new Date() : device.lastUsedAt },
        })
        .catch(() => undefined);
    }
    await prisma.walkieMessage.update({ where: { id: message.id }, data: { phones: theirs } });
    phones += theirs;
    if (theirs > 0) heard.push(person.id === managerRow ? "The manager" : person.name);
  }

  return { ok: true, batch, heard, notOn, phones };
}

// --- Conversations ------------------------------------------------------------

export type WalkieItem = {
  id: string;
  /** Said by the one reading. */
  mine: boolean;
  fromName: string;
  scope: string;
  audioUrl: string;
  seconds: number | null;
  at: Date;
  /** For what the reader said: how many of the phones Apple took it for, and when it was heard. */
  phones: number;
  heardAt: Date | null;
  /** For a press to everybody, each person's own answer. */
  recipients?: { key: string; phones: number; heardAt: Date | null }[];
};

/**
 * One conversation, oldest first: what the reader and `withKey` said to each
 * other — and, from them, what they said to everybody. `withKey` "all" is the
 * reader's own presses to everybody, one item per press with each person's answer.
 */
export async function walkieThread(speaker: WalkieSpeaker, withKey: string, take = 80): Promise<WalkieItem[]> {
  const me = speakerKey(speaker);

  if (withKey === "all") {
    const rows = await prisma.walkieMessage.findMany({
      where: { fromKey: me, scope: "all" },
      orderBy: { createdAt: "desc" },
      take: take * 12,
    });
    const batches = new Map<string, WalkieItem>();
    for (const row of rows) {
      const key = row.batch || row.id;
      const item = batches.get(key) ?? {
        id: row.id,
        mine: true,
        fromName: row.fromName,
        scope: "all",
        audioUrl: row.audioUrl,
        seconds: row.seconds,
        at: row.createdAt,
        phones: 0,
        heardAt: null,
        recipients: [],
      };
      item.phones += row.phones;
      item.recipients!.push({ key: row.toKey, phones: row.phones, heardAt: row.heardAt });
      batches.set(key, item);
    }
    return [...batches.values()].slice(0, take).reverse();
  }

  const rows = await prisma.walkieMessage.findMany({
    where: {
      OR: [
        { fromKey: me, toKey: withKey, scope: "one" },
        { fromKey: withKey, toKey: me },
      ],
    },
    orderBy: { createdAt: "desc" },
    take,
  });
  return rows.reverse().map((row) => ({
    id: row.id,
    mine: row.fromKey === me,
    fromName: row.fromName,
    scope: row.scope,
    audioUrl: row.audioUrl,
    seconds: row.seconds,
    at: row.createdAt,
    phones: row.phones,
    heardAt: row.heardAt,
  }));
}

/**
 * Its owner's phone has played it. Only the one it was for can say so, and only
 * once: the first time is the time it was heard.
 */
export async function markWalkieHeard(speaker: WalkieSpeaker, id: string) {
  const result = await prisma.walkieMessage.updateMany({
    where: { id, toKey: speakerKey(speaker), heardAt: null },
    data: { heardAt: new Date() },
  });
  return result.count > 0;
}

/** For each person, when the reader and they last spoke, and how many of theirs the reader has not heard. */
export async function walkieLatest(speaker: WalkieSpeaker) {
  const me = speakerKey(speaker);
  const rows = await prisma.walkieMessage.findMany({
    where: { OR: [{ fromKey: me }, { toKey: me }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { fromKey: true, toKey: true, scope: true, createdAt: true, heardAt: true },
  });
  const latest = new Map<string, { lastAt: Date; unheard: number }>();
  for (const row of rows) {
    const other = row.fromKey === me ? (row.scope === "all" ? "all" : row.toKey) : row.fromKey;
    const entry = latest.get(other) ?? { lastAt: row.createdAt, unheard: 0 };
    if (row.toKey === me && !row.heardAt) entry.unheard += 1;
    latest.set(other, entry);
  }
  return latest;
}
