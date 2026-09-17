import { dispatchNotification } from "@/lib/notifications/engine";
import { meetingsStartingBetween, type MeetingToTellAbout } from "@/lib/chat-meeting-store";
import { adminChatUrl, conversationFromKey, employeeChatUrl } from "@/lib/chat-conversations";
import { MANAGER_MEMBER_KEY, managerEmployeeId } from "@/lib/manager-account";
import { endsAt, remindAt, whenLabel } from "@/lib/chat-meetings";
import { avatarUrl } from "@/lib/avatar";

// Telling people a meeting is coming, and that it has come.
//
// Two moments each: the warning, however long before the manager asked for,
// and the start itself. Nothing here opens a call — a call started by a job
// with no browser behind it ends itself within seconds and is written into the
// chat as missed. This says the moment has arrived; a person opens the call.
//
// There is no queue of its own, unlike the follow-ups. The notification's own
// unique dedupeKey is the record of having told somebody, and every key carries
// the meeting's start, so a moved meeting earns a new one and an unmoved one is
// never sent twice — however often, or however late, this runs.

const MANAGER_ICON = avatarUrl("Manager", "ink");

// Wide enough that a scheduler which missed a turn still says something, and
// narrow enough that yesterday's meetings are not announced this morning.
const LOOK_BACK_MINUTES = 90;
const LOOK_AHEAD_MINUTES = 90;

/** Where the notification opens it: the chat, scrolled to the card. */
function urlFor(channelKey: string, meetingId: string, employeeId: string, forManager = false) {
  const conversation = conversationFromKey(channelKey);
  // The manager's link leads to the admin — they cannot sign in to the employee
  // portal, so an /employee link would open a page that turns them away.
  if (!conversation) return forManager ? "/admin/chat" : "/employee/chat";
  const chat = forManager ? adminChatUrl(conversation) : employeeChatUrl(conversation, employeeId);
  return `${chat}?meeting=${meetingId}`;
}

function clip(text: string, length = 140) {
  return text.length > length ? `${text.slice(0, length - 1)}…` : text;
}

/** What the card says it is: a place for one kind, a call for the other. */
function whereLine(meeting: MeetingToTellAbout) {
  if (meeting.mode !== "IN_PERSON") return "Open the chat to join.";
  return meeting.place ? `At ${meeting.place}.` : "In person.";
}

export async function runMeetingReminders(now: Date, timeZone: string) {
  const from = new Date(now.getTime() - LOOK_BACK_MINUTES * 60_000);
  const to = new Date(now.getTime() + LOOK_AHEAD_MINUTES * 60_000);

  const meetings = await meetingsStartingBetween(from, to);
  // Looked up once for the whole pass rather than once per attendee: this runs
  // every minute, over every meeting in the window.
  const managerId = await managerEmployeeId();
  const sending: Promise<unknown>[] = [];
  let warned = 0;
  let started = 0;

  for (const meeting of meetings) {
    const startsAt = new Date(meeting.startsAt);
    const warnAt = remindAt(startsAt, meeting.remindMinutes);
    const over = endsAt(startsAt, meeting.durationMinutes).getTime();

    // The warning is owed once its moment has passed and the meeting has not.
    const owesWarning = warnAt !== null && warnAt.getTime() <= now.getTime() && startsAt.getTime() > now.getTime();
    // The word that it has begun is owed while it is actually running.
    const owesStart = startsAt.getTime() <= now.getTime() && now.getTime() < over;
    if (!owesWarning && !owesStart) continue;

    const stamp = startsAt.toISOString();
    const when = whenLabel(startsAt, now, timeZone);

    for (const person of meeting.attendees) {
      // The manager used to be skipped here, having no Employee row to address
      // and so no phone to reach. They have one now, and a reminder ten minutes
      // before is exactly what somebody wants on a phone even when they were
      // the one who set the meeting. Null means nobody is paired as manager —
      // then there is nothing to tell, and everybody else is still told.
      const forManager = person.memberKey === MANAGER_MEMBER_KEY;
      const employeeId = forManager ? managerId : person.memberKey;
      if (!employeeId) continue;
      // Somebody who said they are not coming is not chased about it.
      if (person.rsvp === "DECLINED") continue;

      const url = urlFor(meeting.channel.key, meeting.id, person.memberKey, forManager);

      if (owesWarning) {
        warned++;
        sending.push(
          dispatchNotification({
            employeeId,
            // A meeting is a company matter rather than a convenience, so it is
            // not something a preference can silence.
            type: "SYSTEM_NOTIFICATION",
            title: `Meeting in ${meeting.remindMinutes} min`,
            message: clip(`${meeting.title} — ${when}. ${whereLine(meeting)}`),
            url,
            icon: MANAGER_ICON,
            dedupeKey: `MEETING_SOON:${meeting.id}:${person.memberKey}:${stamp}`,
            metadata: { chatMeetingId: meeting.id },
          }).catch(() => undefined)
        );
      }

      if (owesStart) {
        started++;
        sending.push(
          dispatchNotification({
            employeeId,
            type: "SYSTEM_NOTIFICATION",
            title: "Meeting starting now",
            message: clip(`${meeting.title}. ${whereLine(meeting)}`),
            url,
            icon: MANAGER_ICON,
            dedupeKey: `MEETING_NOW:${meeting.id}:${person.memberKey}:${stamp}`,
            metadata: { chatMeetingId: meeting.id },
          }).catch(() => undefined)
        );
      }
    }
  }

  await Promise.all(sending);
  return { considered: meetings.length, warned, started };
}
