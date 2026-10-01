import { prisma } from "@/lib/db";
import { MANAGER_ACCESS_ROLE, MANAGER_MEMBER_KEY } from "@/lib/manager-account";

// Whose face is whose, for the rows that hold a member key rather than a
// person.
//
// `CallParticipant` and `ChatMeetingAttendee` copy a name and a colour onto
// themselves, and a chat message copies its author's name — right for all
// three, because who was in that call and what they were called at the time is
// a fact about the call. A face is not: it is a current fact about a person,
// and a copied one would go stale the moment they changed it. So it is
// resolved when the row is read, in one query for the whole set.
//
// "admin" is the manager, who is a session rather than a person everywhere
// else; `manager-account.ts` says why they nonetheless have a row. This is the
// second place that looks it up on purpose.
//
// Not "use server": every export of one of those is callable over the network.

/** Member key → the URL of that person's photo. Only people who have one appear. */
export type Faces = Record<string, string>;

export async function facesFor(memberKeys: Iterable<string>): Promise<Faces> {
  const keys = new Set(memberKeys);
  if (keys.size === 0) return {};

  const wantsManager = keys.delete(MANAGER_MEMBER_KEY);
  const faces: Faces = {};

  if (keys.size > 0) {
    const people = await prisma.employee.findMany({
      where: { id: { in: [...keys] }, photoUrl: { not: null } },
      select: { id: true, photoUrl: true },
    });
    for (const person of people) {
      if (person.photoUrl) faces[person.id] = person.photoUrl;
    }
  }

  if (wantsManager) {
    const manager = await prisma.employee.findFirst({
      where: { accessRole: MANAGER_ACCESS_ROLE, active: true, photoUrl: { not: null } },
      orderBy: { createdAt: "asc" },
      select: { photoUrl: true },
    });
    if (manager?.photoUrl) faces[MANAGER_MEMBER_KEY] = manager.photoUrl;
  }

  return faces;
}

/**
 * Every member key a screenful of messages will want to draw: who wrote each
 * one, who is on a task card, and who was asked to a meeting.
 *
 * Typed against the fields it reads rather than the message shape, which
 * carries four relations and would drag all of them in here.
 */
export function keysInMessages(
  messages: {
    authorType: string;
    authorId: string | null;
    task?: { assignments: { employeeId: string }[] } | null;
    meeting?: { attendees: { memberKey: string }[] } | null;
  }[]
): string[] {
  const keys: string[] = [];

  for (const message of messages) {
    keys.push(message.authorType === "ADMIN" ? MANAGER_MEMBER_KEY : (message.authorId ?? ""));
    for (const part of message.task?.assignments ?? []) keys.push(part.employeeId);
    for (const one of message.meeting?.attendees ?? []) keys.push(one.memberKey);
  }

  return keys.filter(Boolean);
}
