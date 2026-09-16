import { dispatchNotification } from "@/lib/notifications/engine";
import { meetingsStartingBetween, type MeetingToTellAbout } from "@/lib/chat-meeting-store";
import { conversationFromKey, employeeChatUrl } from "@/lib/chat-conversations";
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
function urlFor(channelKey: string, meetingId: string, employeeId: string) {
  const conversation = conversationFromKey(channelKey);
  return conversation ? `${employeeChatUrl(conversation, employeeId)}?meeting=${meetingId}` : "/employee/chat";
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
      // The manager has no Employee row and receives no push; they are told in
      // the app, by the card itself.
      if (person.memberKey === "admin") continue;
      // Somebody who said they are not coming is not chased about it.
      if (person.rsvp === "DECLINED") continue;

      const url = urlFor(meeting.channel.key, meeting.id, person.memberKey);

      if (owesWarning) {
        warned++;
        sending.push(
          dispatchNotification({
            employeeId: person.memberKey,
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
            employeeId: person.memberKey,
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
