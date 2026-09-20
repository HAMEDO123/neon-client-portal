import { chatMeetingForAction, setRsvpRecord } from "@/lib/chat-meeting-store";
import { conversationFromKey, mayOpen } from "@/lib/chat-conversations";
import { mayRespond, memberKeyOf } from "@/lib/chat-meetings";
import { notifyAdmin } from "@/lib/admin-notifications";
import { adminMeetingUrl } from "@/lib/chat-meeting-urls";
import type { ChatViewer } from "@/lib/chat-conversations";
import type { MeetingRsvp } from "@/generated/prisma/enums";

// Answering a meeting invitation, for the web action and the mobile API both.
//
// The checks are the point of sharing it: only somebody who can open the
// conversation, and only somebody who was actually asked, may answer — and the
// manager hears what each person said while nobody hears their own answer.
// Written twice, the mobile copy would be the one that forgets a check.
//
// Not "use server": it takes a viewer as an argument.

export type RsvpResult =
  | { ok: true }
  | { ok: false; status: 404 | 403 | 400; reason: string };

export async function respondToMeeting(
  viewer: ChatViewer,
  meetingId: string,
  answer: string
): Promise<RsvpResult> {
  if (answer !== "ACCEPTED" && answer !== "DECLINED" && answer !== "INVITED") {
    return { ok: false, status: 400, reason: "That is not an answer." };
  }

  const meeting = await chatMeetingForAction(meetingId);
  if (!meeting) return { ok: false, status: 404, reason: "That meeting no longer exists." };

  const conversation = conversationFromKey(meeting.channel.key);
  const memberKeys = meeting.attendees.map((one) => one.memberKey);
  if (!conversation || !mayOpen(viewer, conversation) || !mayRespond(viewer, memberKeys)) {
    return { ok: false, status: 403, reason: "Only the people asked to this meeting can answer it." };
  }

  await setRsvpRecord(meeting.id, memberKeyOf(viewer), answer as MeetingRsvp);

  // The manager hears what each person said; nobody hears their own answer.
  if (viewer.type === "EMPLOYEE") {
    void notifyAdmin({
      type: "CHAT_MESSAGE",
      title: `${viewer.name} on "${meeting.title.slice(0, 60)}"`,
      message: answer === "ACCEPTED" ? "Coming." : answer === "DECLINED" ? "Not coming." : "Has not answered yet.",
      url: adminMeetingUrl(meeting.channel.key, meeting.id),
      dedupeKey: `CHAT_MEETING_RSVP:${meeting.id}:${viewer.id}:${answer}`,
      employeeId: viewer.id,
    });
  }

  return { ok: true };
}
