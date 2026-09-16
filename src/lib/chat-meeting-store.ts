import type { MeetingMode, MeetingRsvp } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { messageSelect } from "@/lib/chat";
import { chatMeetingSelect } from "@/lib/chat-meeting-select";
import {
  conversationFromKey,
  conversationSlug,
  mayOpen,
  type ChatViewer,
  type Conversation,
} from "@/lib/chat-conversations";
import { sortMeetingList } from "@/lib/chat-meetings";

// Meeting cards in the database: writing one together with everybody asked to
// it, what the live stream and the Meetings list read, and the meetings a
// scheduled pass has to tell people about. The rules are chat-meetings.ts; the
// sessions and notifications are actions/chat-meeting-actions.ts.
//
// Not "use server": every export of one of those is callable over the network,
// and these trust their caller to have checked who is asking.

/** The manager, as an attendee. They have no Employee row, so they are a key. */
export const MANAGER_MEMBER = { key: "admin", name: "Manager", color: "ink" } as const;

/**
 * The people a meeting in this conversation can ask: the manager and the whole
 * team in the group, the manager and the one person in a private chat, and
 * nobody in a chat between two employees — the same door taskMembers opens.
 */
export async function meetingMembers(conversation: Conversation) {
  if (conversation.kind === "peer") return [];

  const employees = await prisma.employee.findMany({
    where: {
      active: true,
      accessRole: "EMPLOYEE",
      ...(conversation.kind === "direct" ? { id: conversation.employeeId } : {}),
    },
    orderBy: { order: "asc" },
    select: { id: true, name: true, color: true },
  });

  return [
    { key: MANAGER_MEMBER.key, name: MANAGER_MEMBER.name, color: MANAGER_MEMBER.color as string | null },
    ...employees.map((one) => ({ key: one.id, name: one.name, color: one.color })),
  ];
}

export type MeetingMember = Awaited<ReturnType<typeof meetingMembers>>[number];

export type NewChatMeeting = {
  channelId: string;
  authorName: string;
  title: string;
  agenda: string | null;
  mode: MeetingMode;
  place: string | null;
  startsAt: Date;
  durationMinutes: number;
  remindMinutes: number;
  attendees: { key: string; name: string; color: string | null }[];
};

/**
 * Writes the message, its card and everybody asked to it, all together or not
 * at all — the same reason a task card is written in one transaction: a meeting
 * in the chat that nobody was asked to is worse than no meeting.
 */
export async function createChatMeetingRecords(input: NewChatMeeting) {
  return prisma.$transaction(async (tx) => {
    const message = await tx.chatMessage.create({
      data: {
        channelId: input.channelId,
        authorType: "ADMIN",
        authorName: input.authorName,
        kind: "MEETING",
        // The title, so the chat list and a lock screen can say what it is.
        body: input.title,
      },
      select: { id: true },
    });

    const meeting = await tx.chatMeeting.create({
      data: {
        channelId: input.channelId,
        messageId: message.id,
        title: input.title,
        agenda: input.agenda,
        mode: input.mode,
        place: input.place,
        startsAt: input.startsAt,
        durationMinutes: input.durationMinutes,
        remindMinutes: input.remindMinutes,
        attendees: {
          create: input.attendees.map((one) => ({ memberKey: one.key, name: one.name, color: one.color })),
        },
      },
      select: { id: true, attendees: { select: { id: true, memberKey: true } } },
    });

    const saved = await tx.chatMessage.findUniqueOrThrow({ where: { id: message.id }, select: messageSelect });
    return { message: saved, meetingId: meeting.id, asked: meeting.attendees };
  });
}

/** A card with what deciding about it needs: where it is, and who was asked. */
export function chatMeetingForAction(meetingId: string) {
  return prisma.chatMeeting.findUnique({
    where: { id: meetingId },
    select: {
      id: true,
      title: true,
      messageId: true,
      startsAt: true,
      channel: { select: { key: true } },
      attendees: { select: { id: true, memberKey: true, name: true } },
    },
  });
}

/** One person's answer to an invitation. Only ever their own row. */
export function setRsvpRecord(meetingId: string, memberKey: string, rsvp: MeetingRsvp) {
  return prisma.chatMeetingAttendee.update({
    where: { meetingId_memberKey: { meetingId, memberKey } },
    data: { rsvp, respondedAt: new Date() },
    select: { id: true, memberKey: true, rsvp: true, updatedAt: true },
  });
}

/**
 * Everything about one conversation's meetings that can change without a new
 * message — a meeting added or called off, somebody answering — folded into one
 * string. The live stream sends the cards again only when it moves.
 */
export async function meetingSignature(channelId: string) {
  const rows = await prisma.$queryRaw<{ sig: string }[]>`
    SELECT concat_ws('.',
      (SELECT COUNT(*) FROM "ChatMeeting" WHERE "channelId" = ${channelId}),
      (SELECT COALESCE(EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000, 0)::bigint FROM "ChatMeeting" WHERE "channelId" = ${channelId}),
      (SELECT COUNT(*) FROM "ChatMeetingAttendee" a JOIN "ChatMeeting" m ON m.id = a."meetingId" WHERE m."channelId" = ${channelId}),
      (SELECT COALESCE(EXTRACT(EPOCH FROM MAX(a."updatedAt")) * 1000, 0)::bigint
         FROM "ChatMeetingAttendee" a JOIN "ChatMeeting" m ON m.id = a."meetingId" WHERE m."channelId" = ${channelId})
    ) AS sig
  `;
  return rows[0]?.sig ?? "";
}

/**
 * The meeting cards of one conversation as they stand: every card's id — so one
 * that was called off can be taken off the screen — and the newest hundred in
 * full. `at` is taken before either is read, so a screen can tell a card that is
 * missing because it was called off from one made after the snapshot.
 */
export async function meetingSnapshot(channelId: string) {
  const at = Date.now();
  const ids = await prisma.chatMeeting.findMany({ where: { channelId }, select: { id: true } });
  const meetings = await prisma.chatMeeting.findMany({
    where: { channelId },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: chatMeetingSelect,
  });
  return { at, ids: ids.map((row) => row.id), meetings };
}

export type ChatMeetingView = Awaited<ReturnType<typeof meetingSnapshot>>["meetings"][number];

const listSelect = {
  id: true,
  messageId: true,
  title: true,
  mode: true,
  place: true,
  startsAt: true,
  durationMinutes: true,
  createdAt: true,
  attendees: {
    orderBy: { createdAt: "asc" },
    select: { id: true, memberKey: true, name: true, color: true, rsvp: true },
  },
  channel: { select: { key: true, name: true } },
} as const;

/**
 * The Meetings list. For the manager, every meeting set in a chat; for an
 * employee, the ones they were asked to. Each with the conversation it lives
 * in, as this viewer names it, soonest first.
 */
export async function meetingListFor(viewer: ChatViewer, now = Date.now()) {
  const rows = await prisma.chatMeeting.findMany({
    where: viewer.type === "ADMIN" ? {} : { attendees: { some: { memberKey: viewer.id } } },
    orderBy: { startsAt: "desc" },
    take: 300,
    select: listSelect,
  });

  const items = rows.flatMap(({ channel, ...meeting }) => {
    const conversation = conversationFromKey(channel.key);
    // The same door as every other read: a card is listed only for somebody who may open its chat.
    if (!conversation || !mayOpen(viewer, conversation)) return [];
    return [
      {
        ...meeting,
        conversationSlug: conversationSlug(conversation, viewer),
        conversationTitle: conversation.kind === "direct" && viewer.type === "EMPLOYEE" ? "Manager" : channel.name,
        isGroup: conversation.kind === "team",
      },
    ];
  });

  return sortMeetingList(items, now);
}

export type MeetingListItem = Awaited<ReturnType<typeof meetingListFor>>[number];

/**
 * The meetings a scheduled pass has to consider: everything starting inside the
 * window it is asked about, with who was asked and where the card lives.
 *
 * Deliberately a plain read rather than a queue of its own. Whether each person
 * has already been told is the unique dedupeKey on the notification itself, so
 * a pass that runs twice, or late, tells nobody twice.
 */
export async function meetingsStartingBetween(from: Date, to: Date) {
  return prisma.chatMeeting.findMany({
    where: { startsAt: { gte: from, lte: to } },
    orderBy: { startsAt: "asc" },
    take: 200,
    select: {
      id: true,
      title: true,
      mode: true,
      place: true,
      startsAt: true,
      durationMinutes: true,
      remindMinutes: true,
      channel: { select: { key: true } },
      attendees: { select: { memberKey: true, name: true, rsvp: true } },
    },
  });
}

export type MeetingToTellAbout = Awaited<ReturnType<typeof meetingsStartingBetween>>[number];
