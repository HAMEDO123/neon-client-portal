"use client";

import { useId, useState, useTransition } from "react";
import {
  CalendarClock,
  Check,
  CircleAlert,
  Loader2,
  MapPin,
  MoreVertical,
  PhoneIncoming,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import type { MeetingRsvp } from "@/generated/prisma/enums";
import type { ChatMeetingView } from "@/lib/chat-meeting-store";
import type { ChatViewer } from "@/lib/chat-conversations";
import {
  RSVP_LABEL,
  endsAt,
  isLive,
  isPast,
  mayRespond,
  memberKeyOf,
  rsvpCounts,
  startsDistance,
  whenLabel,
} from "@/lib/chat-meetings";
import { cancelChatMeeting, setMeetingRsvp } from "@/lib/actions/chat-meeting-actions";
import { useCalls } from "@/components/calls/call-provider";
import { useMinuteNow } from "@/lib/use-minute-now";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { cn } from "@/lib/utils";

// A meeting the manager set, as a card in the conversation.
//
// Everyone asked to it sees the same card: what it is about, when it starts,
// who is coming, and — for an online one, once the time is near — the way into
// the call. The card never starts a call by itself: pressing Join is what opens
// it, and whoever presses first opens it for everybody, because starting a call
// reuses the one already running in that conversation.
//
// An answer shows at once and is kept on screen until the server's own copy of
// that row changes; if it is refused, it goes back and says why. The palette is
// the task card's on purpose — this card is shared with the employees' phone,
// so the manager and the person holding a phone are looking at the same thing.

type Attendee = ChatMeetingView["attendees"][number];

// How long before it starts the way in appears.
const DOORS_OPEN_MINUTES = 10;

const RSVP_PILL: Record<MeetingRsvp, string> = {
  INVITED: "bg-ink/[0.06] text-ink/55",
  ACCEPTED: "bg-emerald-500/15 text-emerald-700",
  DECLINED: "bg-ink/[0.06] text-ink/45",
};

const BUTTON =
  "inline-flex h-9 items-center justify-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold transition-[transform,background-color,opacity] duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1";
const TONE = {
  cyan: "bg-cyan-strong text-white hover:bg-cyan-strong/90 focus-visible:ring-cyan-strong",
  emerald: "bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-600",
  ghost: "bg-ink/[0.05] text-ink/70 hover:bg-ink/[0.09] focus-visible:ring-ink/30",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-600",
} as const;

function failure(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export function MeetingCard({
  meeting,
  viewer,
  conversation,
  timeZone,
  initialNow,
  onCancelled,
}: {
  meeting: ChatMeetingView;
  viewer: ChatViewer;
  /** The conversation as its URL names it — what a call is started in. */
  conversation: string;
  timeZone: string;
  /** The server's clock when the page was drawn, until the device's own takes over. */
  initialNow: number;
  onCancelled: () => void;
}) {
  const now = useMinuteNow() ?? initialNow;
  const titleId = useId();
  const calls = useCalls();

  // An answer shown ahead of the server, keyed to the version of the row it was made on.
  const [ahead, setAhead] = useState<Record<string, { version: number; to: MeetingRsvp }>>({});
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, startCancelling] = useTransition();
  const [answering, startAnswering] = useTransition();

  const attendees: Attendee[] = meeting.attendees.map((one) => {
    const shown = ahead[one.id];
    return shown && shown.version === new Date(one.updatedAt).getTime() ? { ...one, rsvp: shown.to } : one;
  });

  const myKey = memberKeyOf(viewer);
  const mine = attendees.find((one) => one.memberKey === myKey);
  const canAnswer = mayRespond(
    viewer,
    attendees.map((one) => one.memberKey)
  );

  const counts = rsvpCounts(attendees);
  const live = isLive(meeting.startsAt, meeting.durationMinutes, now);
  const over = isPast(meeting.startsAt, meeting.durationMinutes, now);
  const distance = startsDistance(meeting.startsAt, now);
  const isManager = viewer.type === "ADMIN";
  const agenda = meeting.agenda ?? "";
  const longAgenda = agenda.length > 160 || agenda.split("\n").length > 3;

  // The way in opens a little before the hour and closes when it is over.
  const opensAt = new Date(meeting.startsAt).getTime() - DOORS_OPEN_MINUTES * 60_000;
  const joinable = meeting.mode === "ONLINE" && now >= opensAt && now < endsAt(meeting.startsAt, meeting.durationMinutes).getTime();

  function answer(to: MeetingRsvp) {
    if (!mine) return;
    const version = new Date(mine.updatedAt).getTime();
    setError(null);
    setAhead((current) => ({ ...current, [mine.id]: { version, to } }));

    startAnswering(async () => {
      try {
        const formData = new FormData();
        formData.set("meetingId", meeting.id);
        formData.set("rsvp", to);
        formData.set("as", viewer.type);
        await setMeetingRsvp(formData);
      } catch (cause) {
        setAhead((current) => {
          const next = { ...current };
          delete next[mine.id];
          return next;
        });
        setError(failure(cause, "That did not save. Try again."));
      }
    });
  }

  function callOff() {
    startCancelling(async () => {
      try {
        await cancelChatMeeting(meeting.id);
        onCancelled();
      } catch (cause) {
        setConfirming(false);
        setError(failure(cause, "Could not call it off. Try again."));
      }
    });
  }

  return (
    <article
      id={`meeting-${meeting.id}`}
      aria-labelledby={titleId}
      className={cn(
        "relative w-[min(22rem,calc(100vw-4.5rem))] rounded-2xl bg-white text-left shadow-sm ring-1 transition-opacity",
        live ? "ring-emerald-500/45" : "ring-ink/10",
        (cancelling || over) && "opacity-60"
      )}
    >
      <div aria-hidden className={cn("h-1 rounded-t-2xl", live ? "bg-emerald-500" : over ? "bg-ink/15" : "bg-cyan-strong")} />

      <div className="px-3 pb-2.5 pt-2.5">
        <header className="flex items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink/55">
            <CalendarClock size={11} strokeWidth={2.5} aria-hidden />
            Meeting
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-semibold text-ink/55">
            {meeting.mode === "ONLINE" ? <Video size={11} aria-hidden /> : <MapPin size={11} aria-hidden />}
            {meeting.mode === "ONLINE" ? "Online" : "In person"}
          </span>
          {live && (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">Now</span>
          )}
          {over && <span className="rounded-full bg-ink/[0.06] px-2 py-0.5 text-[11px] font-semibold text-ink/45">Over</span>}
          {isManager && !over && <CardMenu disabled={cancelling} onCancel={() => setConfirming(true)} />}
        </header>

        <h3 id={titleId} dir="auto" className="mt-2 break-words text-[15px] font-semibold leading-snug text-ink">
          {meeting.title}
        </h3>

        {agenda && (
          <div className="mt-1">
            <p
              dir="auto"
              className={cn("whitespace-pre-wrap break-words text-sm text-ink/65", !expanded && longAgenda && "line-clamp-3")}
            >
              {agenda}
            </p>
            {longAgenda && (
              <button
                type="button"
                onClick={() => setExpanded(!expanded)}
                aria-expanded={expanded}
                className="mt-0.5 rounded text-xs font-semibold text-cyan-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/40"
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}

        <p className={cn("mt-2.5 flex flex-wrap items-center gap-x-1.5 text-[13px]", live ? "font-medium text-emerald-700" : "text-ink/60")}>
          <CalendarClock size={14} strokeWidth={2} aria-hidden />
          <span className="sr-only">Starts</span>
          <span>{whenLabel(meeting.startsAt, now, timeZone)}</span>
          {!over && <span className={live ? "text-emerald-700" : "text-ink/40"}>· {distance.text}</span>}
        </p>

        {meeting.mode === "IN_PERSON" && meeting.place && (
          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-ink/60">
            <MapPin size={14} strokeWidth={2} aria-hidden />
            <span dir="auto" className="min-w-0 break-words">
              {meeting.place}
            </span>
          </p>
        )}

        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink/45">
          <Users size={13} strokeWidth={2} aria-hidden />
          {counts.accepted} coming
          {counts.declined > 0 && ` · ${counts.declined} not`}
          {counts.pending > 0 && ` · ${counts.pending} not answered`}
        </p>

        <ul className="mt-1.5 flex flex-col divide-y divide-ink/[0.06]">
          {attendees.map((one) => (
            <li key={one.id} className="flex items-center gap-2.5 py-2">
              <PersonAvatar name={one.name} color={one.color} size={28} />
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {one.memberKey === myKey ? "You" : one.name}
              </p>
              <span className={cn("shrink-0 rounded-full px-1.5 py-px text-[11px] font-semibold", RSVP_PILL[one.rsvp])}>
                {RSVP_LABEL[one.rsvp]}
              </span>
            </li>
          ))}
        </ul>

        {canAnswer && !over && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={answering || mine?.rsvp === "ACCEPTED"}
              onClick={() => answer("ACCEPTED")}
              className={cn(BUTTON, mine?.rsvp === "ACCEPTED" ? TONE.ghost : TONE.emerald)}
            >
              {answering ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Check size={14} strokeWidth={2.75} aria-hidden />}
              Coming
            </button>
            <button
              type="button"
              disabled={answering || mine?.rsvp === "DECLINED"}
              onClick={() => answer("DECLINED")}
              className={cn(BUTTON, TONE.ghost)}
            >
              <X size={14} strokeWidth={2.5} aria-hidden />
              Can&apos;t make it
            </button>
          </div>
        )}

        {joinable && <JoinButton calls={calls} conversation={conversation} title={meeting.title} />}

        {meeting.mode === "ONLINE" && !joinable && !over && (
          <p className="mt-2 text-xs text-ink/40">The way in opens {DOORS_OPEN_MINUTES} minutes before it starts.</p>
        )}

        {error && (
          <p role="alert" className="neon-rise mt-2 flex items-start gap-1.5 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs text-red-700">
            <CircleAlert size={13} strokeWidth={2.25} className="mt-px shrink-0" aria-hidden />
            {error}
          </p>
        )}

        {confirming && (
          <div role="alertdialog" aria-labelledby={`${titleId}-cancel`} className="neon-rise mt-2.5 rounded-xl bg-red-50 p-2.5">
            <p id={`${titleId}-cancel`} className="text-xs text-red-800">
              Call this meeting off? Everybody asked to it is told, and the card goes.
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                autoFocus
                disabled={cancelling}
                onClick={() => setConfirming(false)}
                className={cn(BUTTON, TONE.ghost)}
              >
                Keep it
              </button>
              <button type="button" disabled={cancelling} onClick={callOff} className={cn(BUTTON, TONE.danger)}>
                {cancelling ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Trash2 size={14} aria-hidden />}
                {cancelling ? "Calling off…" : "Call off"}
              </button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * The way into an online meeting. Whoever presses first opens the call and
 * everybody after them joins the same one — starting a call in a conversation
 * reuses the one already running there, so no coordination is needed here.
 */
function JoinButton({
  calls,
  conversation,
  title,
}: {
  calls: ReturnType<typeof useCalls>;
  conversation: string;
  title: string;
}) {
  if (!calls) return null;

  const ongoing = calls.calls.find((call) => call.conversationSlug === conversation && call.status !== "ENDED");

  if (ongoing && calls.activeCallId === ongoing.id) {
    return (
      <button type="button" onClick={calls.expand} className={cn(BUTTON, TONE.emerald, "mt-2 w-full")}>
        <PhoneIncoming size={15} aria-hidden />
        Back to the meeting
      </button>
    );
  }

  if (ongoing && ongoing.participants.some((part) => part.state === "JOINED")) {
    return (
      <button
        type="button"
        onClick={() => calls.prepare({ mode: "join", callId: ongoing.id, kind: ongoing.kind, title })}
        className={cn(BUTTON, TONE.emerald, "mt-2 w-full")}
      >
        <span aria-hidden className="relative flex h-2 w-2">
          <span className="absolute inset-0 animate-ping rounded-full bg-white/80" />
          <span className="relative h-2 w-2 rounded-full bg-white" />
        </span>
        Join the meeting
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => calls.prepare({ mode: "start", conversation, kind: "VIDEO", title })}
      className={cn(BUTTON, TONE.cyan, "mt-2 w-full")}
    >
      <Video size={15} aria-hidden />
      Open the meeting
    </button>
  );
}

function CardMenu({ disabled, onCancel }: { disabled: boolean; onCancel: () => void }) {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <div
      className="relative ml-auto"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        aria-label="Meeting options"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-ink/40 transition-colors hover:bg-ink/5 hover:text-ink/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
      >
        <MoreVertical size={16} strokeWidth={2} />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className="neon-rise absolute right-0 top-full z-20 mt-1 min-w-40 rounded-xl bg-white p-1 shadow-lg ring-1 ring-ink/10"
        >
          <button
            type="button"
            role="menuitem"
            autoFocus
            onClick={() => {
              setOpen(false);
              onCancel();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-red-600 hover:bg-red-50 focus-visible:bg-red-50 focus-visible:outline-none"
          >
            <Trash2 size={15} aria-hidden />
            Call it off
          </button>
        </div>
      )}
    </div>
  );
}
