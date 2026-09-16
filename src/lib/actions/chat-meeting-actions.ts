"use server";

import { prisma } from "@/lib/db";
import {
  channelFor,
  chatSide,
  parseConversation,
  recordChatRead,
  requireChatViewer,
  type ChatViewer,
} from "@/lib/chat";
import { conversationFromKey, conversationSlug, employeeChatUrl, mayOpen } from "@/lib/chat-conversations";
import {
  DEFAULT_DURATION,
  DEFAULT_REMIND,
  DURATION_CHOICES,
  MEETING_AGENDA_MAX,
  MEETING_MODES,
  MEETING_PLACE_MAX,
  MEETING_TITLE_MAX,
  REMIND_CHOICES,
  mayRespond,
  mayScheduleMeetings,
  memberKeyOf,
  readAttendees,
  readMinutes,
  readWhen,
  whenLabel,
} from "@/lib/chat-meetings";
import {
  chatMeetingForAction,
  createChatMeetingRecords,
  meetingMembers,
  setRsvpRecord,
} from "@/lib/chat-meeting-store";
import { dispatchNotification } from "@/lib/notifications/engine";
import { notifyAdmin } from "@/lib/admin-notifications";
import { avatarUrl } from "@/lib/avatar";
import { getTimezone } from "@/lib/settings";
import type { MeetingMode, MeetingRsvp } from "@/generated/prisma/enums";

// Setting a meeting from a chat, calling it off, and answering an invitation.
//
// The meeting itself holds no call. An online one's card opens the ordinary
// call in the same conversation when somebody presses Join, because a call
// started by a scheduled job — with no browser behind it — ends itself within
// seconds and is written into the chat as missed. The platform says the moment
// has come; a person opens the call.
//
// Who is asking always comes from the session. A card is only ever reached
// through its conversation, and a conversation only through mayOpen.

const MANAGER_ICON = avatarUrl("Manager", "ink");

/** Where a notification about a meeting opens it on an employee's phone. */
function employeeMeetingUrl(channelKey: string, meetingId: string, employeeId: string) {
  const conversation = conversationFromKey(channelKey);
  return conversation ? `${employeeChatUrl(conversation, employeeId)}?meeting=${meetingId}` : "/employee/chat";
}

/** The same, for the manager. */
function adminMeetingUrl(channelKey: string, meetingId: string) {
  const conversation = conversationFromKey(channelKey);
  const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
  return conversation ? `/admin/chat/${conversationSlug(conversation, manager)}?meeting=${meetingId}` : "/admin/chat";
}

function clip(text: string, length = 140) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

export async function createChatMeeting(formData: FormData) {
  const viewer = await requireChatViewer("ADMIN");
  if (viewer.type !== "ADMIN") throw new Error("Only the manager sets meetings.");

  const conversation = parseConversation(String(formData.get("conversation") ?? ""), viewer);
  const channel = conversation ? await channelFor(viewer, conversation) : null;
  if (!conversation || !channel || !mayScheduleMeetings(viewer, conversation)) {
    throw new Error("A meeting cannot be set in this chat.");
  }

  const title = String(formData.get("title") ?? "").trim().slice(0, MEETING_TITLE_MAX);
  if (!title) throw new Error("Give the meeting a name.");
  const agenda = String(formData.get("agenda") ?? "").trim().slice(0, MEETING_AGENDA_MAX) || null;

  const modeRaw = String(formData.get("mode") ?? "ONLINE");
  const mode = MEETING_MODES.includes(modeRaw as MeetingMode) ? (modeRaw as MeetingMode) : "ONLINE";
  // Only an in-person meeting has a place; an online one is wherever people are.
  const place = mode === "IN_PERSON" ? String(formData.get("place") ?? "").trim().slice(0, MEETING_PLACE_MAX) || null : null;

  const members = await meetingMembers(conversation);
  const asked = readAttendees(
    formData.getAll("attendee").map(String),
    members.map((member) => member.key)
  );
  if (!asked.ok) throw new Error(asked.reason);

  const timezone = await getTimezone();
  const now = new Date();
  const when = readWhen(String(formData.get("day") ?? ""), String(formData.get("time") ?? ""), timezone, now);
  if (!when.ok) throw new Error(when.reason);

  const durationMinutes = readMinutes(String(formData.get("duration") ?? ""), DURATION_CHOICES, DEFAULT_DURATION);
  const remindMinutes = readMinutes(String(formData.get("remind") ?? ""), REMIND_CHOICES, DEFAULT_REMIND);

  const chosen = new Set(asked.keys);
  const created = await createChatMeetingRecords({
    channelId: channel.id,
    authorName: viewer.name,
    title,
    agenda,
    mode,
    place,
    startsAt: when.startsAt,
    durationMinutes,
    remindMinutes,
    attendees: members.filter((member) => chosen.has(member.key)),
  });

  // Setting a meeting counts as having read everything before it.
  await recordChatRead(viewer, channel.id);

  // Telling people runs on its own, like a message: the card is on screen
  // already, and a failed push must never cost the meeting. The manager is not
  // told — they are the one who just set it, and they receive no push anyway.
  const label = whenLabel(when.startsAt, now, timezone);
  const where = mode === "IN_PERSON" ? (place ? ` at ${place}` : "") : "";
  void Promise.all(
    created.asked
      .filter((one) => one.memberKey !== "admin")
      .map((one) =>
        dispatchNotification({
          employeeId: one.memberKey,
          // A meeting somebody is asked to is a company matter rather than a
          // convenience, so it is not something a preference can silence.
          type: "SYSTEM_NOTIFICATION",
          title: "Meeting set by the manager",
          message: clip(`${title} — ${label}${where}.`),
          url: employeeMeetingUrl(channel.key, created.meetingId, one.memberKey),
          icon: MANAGER_ICON,
          dedupeKey: `CHAT_MEETING:${created.meetingId}:${one.memberKey}`,
          metadata: { chatMeetingId: created.meetingId },
        }).catch(() => undefined)
      )
  );

  return created.message;
}

/**
 * Calling a meeting off removes it for everyone: the message, the card and
 * everybody's answer. Only the manager can, and the people asked are told,
 * because it also leaves their day.
 */
export async function cancelChatMeeting(meetingId: string) {
  const viewer = await requireChatViewer("ADMIN");
  if (viewer.type !== "ADMIN") throw new Error("Only the manager calls a meeting off.");

  const meeting = await chatMeetingForAction(meetingId);
  if (!meeting) return;

  await prisma.chatMessage.delete({ where: { id: meeting.messageId } });

  await Promise.all(
    meeting.attendees
      .filter((one) => one.memberKey !== "admin")
      .map((one) =>
        dispatchNotification({
          employeeId: one.memberKey,
          type: "SYSTEM_NOTIFICATION",
          title: "Meeting called off",
          message: clip(`The manager called off "${meeting.title}".`),
          url: "/employee/chat",
          icon: MANAGER_ICON,
          dedupeKey: `CHAT_MEETING_OFF:${meeting.id}:${one.memberKey}`,
        }).catch(() => undefined)
      )
  );
}

/**
 * One person's answer to an invitation — their own row and nobody else's. Not
 * answering stays "not answered": the platform cannot tell somebody who will
 * not come from somebody who has not looked, and must never write down the
 * difference it cannot see.
 */
export async function setMeetingRsvp(formData: FormData) {
  const viewer = await requireChatViewer(chatSide(String(formData.get("as") ?? "")));

  const meeting = await chatMeetingForAction(String(formData.get("meetingId") ?? ""));
  if (!meeting) throw new Error("That meeting no longer exists.");

  const conversation = conversationFromKey(meeting.channel.key);
  const memberKeys = meeting.attendees.map((one) => one.memberKey);
  if (!conversation || !mayOpen(viewer, conversation) || !mayRespond(viewer, memberKeys)) {
    throw new Error("Only the people asked to this meeting can answer it.");
  }

  const answer = String(formData.get("rsvp") ?? "");
  if (answer !== "ACCEPTED" && answer !== "DECLINED" && answer !== "INVITED") {
    throw new Error("That is not an answer.");
  }

  const saved = await setRsvpRecord(meeting.id, memberKeyOf(viewer), answer as MeetingRsvp);

  // The manager hears what each person said; nobody hears their own answer.
  if (viewer.type === "EMPLOYEE") {
    void notifyAdmin({
      type: "CHAT_MESSAGE",
      title: `${viewer.name} on "${clip(meeting.title, 60)}"`,
      message: answer === "ACCEPTED" ? "Coming." : answer === "DECLINED" ? "Not coming." : "Has not answered yet.",
      url: adminMeetingUrl(meeting.channel.key, meeting.id),
      dedupeKey: `CHAT_MEETING_RSVP:${meeting.id}:${viewer.id}:${answer}`,
      employeeId: viewer.id,
    });
  }

  return saved;
}
