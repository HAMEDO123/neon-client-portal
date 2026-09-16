import type { MeetingMode, MeetingRsvp } from "@/generated/prisma/enums";
import type { ChatViewer, Conversation } from "@/lib/chat-conversations";
import { dayKeyIn, instantAt } from "@/lib/time";
import { daysBetween } from "@/lib/week";
import { isWorkingDay, minutesOf, nextWorkingDay, timeOf, type WorkHours } from "@/lib/work-hours";

// Meetings the manager sets from a chat, shown there as cards.
//
// Pure, and the one place their rules are written: what "/meet" means, when a
// meeting starts if nobody says, who may set one, and how a card with several
// people asked to it reads as a whole. The database side is
// chat-meeting-store.ts; the card is components/chat/meeting-card.tsx.
//
// A meeting holds no call. An online one's card opens the ordinary call in the
// same conversation when somebody presses it — nothing here starts anything.

export const MEETING_TITLE_MAX = 200;
export const MEETING_AGENDA_MAX = 4000;
export const MEETING_PLACE_MAX = 200;

export const MEETING_MODES: MeetingMode[] = ["ONLINE", "IN_PERSON"];

/** How long a meeting runs, in minutes: what the form offers. */
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120];

/** How long before it starts everybody is told. 0 is "only at the time". */
export const REMIND_CHOICES = [0, 5, 10, 15, 30, 60];

export const DEFAULT_DURATION = 30;
export const DEFAULT_REMIND = 10;

/** The words on a card for what one person answered. */
export const RSVP_LABEL: Record<MeetingRsvp, string> = {
  INVITED: "Not answered",
  ACCEPTED: "Coming",
  DECLINED: "Not coming",
};

/**
 * What "/meet …" or "/meeting …" typed into the message box means: the meeting
 * form, with the rest of the line as its title. Null for an ordinary message —
 * anchored so "/meetings" and "/meet-notes" are left alone, exactly as
 * slashTask leaves "/taskforce".
 */
export function slashMeeting(text: string): { title: string } | null {
  const match = /^\/meet(?:ing)?(?:\s+([\s\S]*))?$/i.exec(text.trim());
  if (!match) return null;
  return { title: (match[1] ?? "").trim().slice(0, MEETING_TITLE_MAX) };
}

/**
 * Only the manager sets meetings, and only where they are in the conversation:
 * the team's group and their private chats. A chat between two employees has no
 * manager in it — the same rule mayCreateTasks draws.
 */
export function mayScheduleMeetings(viewer: ChatViewer, conversation: Conversation) {
  return viewer.type === "ADMIN" && conversation.kind !== "peer";
}

/** Who may answer an invitation: the people who were asked, and the manager. */
export function mayRespond(viewer: ChatViewer, memberKeys: string[]) {
  const key = viewer.type === "ADMIN" ? "admin" : viewer.id;
  return memberKeys.includes(key);
}

/** The key a viewer is known by on a card: "admin" for the manager. */
export function memberKeyOf(viewer: ChatViewer) {
  return viewer.type === "ADMIN" ? "admin" : viewer.id;
}

export type AttendeeCheck = { ok: true; keys: string[] } | { ok: false; reason: string };

/**
 * The people a meeting asks: everyone named, each once, as long as every one of
 * them is in the conversation. A list with somebody outside it is refused whole
 * rather than quietly trimmed — the same rule readAssignees draws, for the same
 * reason: asking fewer people than the manager chose is a surprise nobody sees
 * until the room is half empty.
 */
export function readAttendees(requested: string[], members: string[]): AttendeeCheck {
  const keys = [...new Set(requested.map((key) => key.trim()).filter(Boolean))];
  if (keys.length === 0) return { ok: false, reason: "Choose who is coming." };

  const inChat = new Set(members);
  if (!keys.every((key) => inChat.has(key))) {
    return { ok: false, reason: "A meeting can only ask people in this chat." };
  }
  return { ok: true, keys };
}

export type WhenCheck = { ok: true; startsAt: Date; dayKey: string } | { ok: false; reason: string };

/** The moment the form names, in the company's timezone, or why it is not one. */
export function readWhen(dayKey: string, time: string, timeZone: string, now: Date): WhenCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return { ok: false, reason: "Pick the day." };
  if (minutesOf(time) == null) return { ok: false, reason: "Pick the time it starts." };

  const startsAt = instantAt(dayKey, time, timeZone);
  // A day that rolls over into the next month ("30 February") is not a day.
  if (!startsAt || dayKeyIn(timeZone, startsAt) !== dayKey) return { ok: false, reason: "That is not a real date." };

  // A minute's grace, for a form filled in a moment ago.
  if (startsAt.getTime() < now.getTime() - 60_000) return { ok: false, reason: "That time has already passed." };

  return { ok: true, startsAt, dayKey };
}

/**
 * A number of minutes off a form. Written out rather than `Number(value) || x`
 * because Number("") and Number(null) are both 0, and 0 is a real answer for a
 * reminder — the trap work-hours.ts keeps its own tests for.
 */
export function readMinutes(value: string | null | undefined, allowed: number[], fallback: number) {
  const text = (value ?? "").trim();
  if (!text) return fallback;
  const minutes = Number(text);
  if (!Number.isInteger(minutes)) return fallback;
  return allowed.includes(minutes) ? minutes : fallback;
}

/**
 * When a new meeting starts unless the manager says otherwise: the next half
 * hour, while the working day still has room for it, and the start of the next
 * working day after that.
 */
export function defaultWhen(hours: WorkHours, timeZone: string, now: Date): { dayKey: string; time: string } {
  const today = dayKeyIn(timeZone, now);
  const endToday = instantAt(today, hours.end, timeZone);

  // Round up to the next half hour, so a form opened at 2:11 proposes 2:30.
  const rounded = new Date(Math.ceil(now.getTime() / (30 * 60_000)) * 30 * 60_000);
  const startOfDay = instantAt(today, hours.start, timeZone);
  const soonest = startOfDay && rounded.getTime() < startOfDay.getTime() ? startOfDay : rounded;

  if (isWorkingDay(hours, today) && endToday && soonest.getTime() + DEFAULT_DURATION * 60_000 <= endToday.getTime()) {
    // The wall clock in the company's timezone, which is what the form shows.
    const wall = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(soonest);
    const [hour, minute] = wall.split(":").map(Number);
    return { dayKey: dayKeyIn(timeZone, soonest), time: timeOf(hour * 60 + minute) };
  }
  return { dayKey: nextWorkingDay(hours, today), time: hours.start };
}

/** When a meeting is over. */
export function endsAt(startsAt: Date | string, durationMinutes: number) {
  return new Date(new Date(startsAt).getTime() + durationMinutes * 60_000);
}

/** Whether it is happening right now — the window a card says "Now" in. */
export function isLive(startsAt: Date | string, durationMinutes: number, now: number) {
  const start = new Date(startsAt).getTime();
  return now >= start && now < start + durationMinutes * 60_000;
}

/** Whether it has finished. */
export function isPast(startsAt: Date | string, durationMinutes: number, now: number) {
  return now >= endsAt(startsAt, durationMinutes).getTime();
}

/**
 * The moment everybody is told it is about to start, or null when the manager
 * asked for no warning. Never before the meeting was made.
 */
export function remindAt(startsAt: Date | string, remindMinutes: number): Date | null {
  if (remindMinutes <= 0) return null;
  return new Date(new Date(startsAt).getTime() - remindMinutes * 60_000);
}

/**
 * The start as a card writes it: "Today, 2:30 PM", "Tomorrow, 11:00 AM",
 * "Yesterday, 3:00 PM", then "Thu 17 Sep, 2:30 PM". Days are the company's.
 * The same shape dueLabel draws for a task, so the two cards read alike.
 */
export function whenLabel(startsAt: Date | string, now: Date | number, timeZone: string) {
  const start = new Date(startsAt);
  const time = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(start);
  const gap = daysBetween(dayKeyIn(timeZone, new Date(now)), dayKeyIn(timeZone, start));

  if (gap === 0) return `Today, ${time}`;
  if (gap === 1) return `Tomorrow, ${time}`;
  if (gap === -1) return `Yesterday, ${time}`;

  // Assembled from parts for the same reason dueLabel assembles it: en-GB's
  // short September is "Sept" in newer ICU, and en-US puts the month first.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", day: "numeric", month: "short" }).formatToParts(start);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("weekday")} ${part("day")} ${part("month")}, ${time}`;
}

/** How far off the start is: "in 45 min", "in 3 h", "in 2 days", "started 10 min ago". */
export function startsDistance(startsAt: Date | string, now: number): { text: string; started: boolean } {
  const diff = new Date(startsAt).getTime() - now;
  const started = diff <= 0;
  const minutes = Math.floor(Math.abs(diff) / 60_000);

  if (minutes < 1) return { text: "now", started };

  const span =
    minutes < 60
      ? `${minutes} min`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)} h`
        : `${Math.floor(minutes / (24 * 60))} days`;

  return { text: started ? `started ${span} ago` : `in ${span}`, started };
}

type Answer = { rsvp: MeetingRsvp };

/**
 * Where a card stands as a whole: how many said yes, how many said no, and how
 * many have not answered. Nothing here calls silence a refusal — not answering
 * and refusing are different facts, and only one of them was said.
 */
export function rsvpCounts(attendees: Answer[]) {
  const accepted = attendees.filter((one) => one.rsvp === "ACCEPTED").length;
  const declined = attendees.filter((one) => one.rsvp === "DECLINED").length;
  return { accepted, declined, pending: attendees.length - accepted - declined, total: attendees.length };
}

/**
 * The Meetings list: what has not happened yet first, the soonest on top, and
 * then what is over, the most recent first.
 */
export function sortMeetingList<T extends { startsAt: Date | string; durationMinutes: number }>(
  items: T[],
  now: number
): T[] {
  const at = (item: T) => new Date(item.startsAt).getTime();
  const ahead = items.filter((item) => !isPast(item.startsAt, item.durationMinutes, now)).sort((a, b) => at(a) - at(b));
  const over = items.filter((item) => isPast(item.startsAt, item.durationMinutes, now)).sort((a, b) => at(b) - at(a));
  return [...ahead, ...over];
}
