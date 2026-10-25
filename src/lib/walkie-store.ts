import { prisma } from "@/lib/db";
import { managerEmployeeId } from "@/lib/manager-account";
import { deviceOutcome, isApnsConfigured, sendPushToTalk } from "@/lib/notifications/apns";
import { getTimezone } from "@/lib/settings";
import { saveFile } from "@/lib/storage";
import { wallClockIn } from "@/lib/time";
import { voiceFor } from "@/lib/walkie-voice";
import { walkieHoursOpen, walkiePayload, type WalkieTarget } from "@/lib/walkie";

// The database and delivery side of the walkie-talkie (lib/walkie.ts has the
// why). Deliberately not "use server": these trust their caller to have
// resolved who is asking.

/** Who is talking: the manager, or somebody on the team. */
export type WalkieSpeaker = { type: "ADMIN" } | { type: "EMPLOYEE"; id: string; name: string };

/** Whether the walkie-talkie may speak now: 10:00–04:00 in the studio's clock (lib/walkie.ts). */
export async function walkieOpen(now = new Date()) {
  const timeZone = await getTimezone();
  return walkieHoursOpen(wallClockIn(timeZone, now));
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
  | { ok: true; heard: string[]; notOn: string[]; phones: number }
  | { ok: false; reason: "closed" | "not-found" | "nobody" | "no-push"; names?: string[] };

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
  if (!(await walkieOpen())) return { ok: false, reason: "closed" };
  if (!isApnsConfigured()) return { ok: false, reason: "no-push" };

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
    select: { id: true, name: true, deviceTokens: { where: { active: true, kind: "PTT" } } },
  });
  if (recipients.length === 0) return { ok: false, reason: "not-found" };

  const listening = recipients.filter((person) => person.deviceTokens.length > 0);
  const notOn = recipients.filter((person) => person.deviceTokens.length === 0).map((person) => (person.id === managerRow ? "The manager" : person.name));
  if (listening.length === 0) return { ok: false, reason: "nobody", names: notOn };

  const fromName = input.speaker.type === "ADMIN" ? "The manager" : input.speaker.name;
  const prepared = await voiceFor(input.voice);
  const saved = await saveFile(prepared.file, "walkie", "audio", false);
  const seconds = input.seconds ?? prepared.seconds;

  const heard: string[] = [];
  let phones = 0;
  for (const person of listening) {
    const message = await prisma.walkieMessage.create({
      data: { employeeId: person.id, fromName, audioUrl: saved.url, seconds },
    });
    const payload = walkiePayload({ id: message.id, audioUrl: saved.url, seconds, fromName });
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

  return { ok: true, heard, notOn, phones };
}
