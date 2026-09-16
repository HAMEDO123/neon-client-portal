"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { MeetingMode } from "@/generated/prisma/enums";
import type { MeetingMember } from "@/lib/chat-meeting-store";
import {
  DURATION_CHOICES,
  MEETING_AGENDA_MAX,
  MEETING_PLACE_MAX,
  MEETING_TITLE_MAX,
  REMIND_CHOICES,
  readWhen,
} from "@/lib/chat-meetings";
import { buttonClasses } from "@/components/ui/buttons";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { cn } from "@/lib/utils";

// Setting a meeting from a chat: what it is about, who is coming, when it
// starts, how long it runs, and how much warning everybody gets.
//
// The same native modal dialog the task form uses, and for the same reasons:
// focus stays inside it, Escape closes it, and it stays open — with the button
// busy — until the meeting is saved, so a mistake the server finds is shown
// here next to the field rather than on a card that then has to be taken back.
// A reason stays on screen only until something in the form changes.

export type MeetingSetup = {
  members: MeetingMember[];
  defaultWhen: { dayKey: string; time: string };
  today: string;
  timeZone: string;
};

const MODE_LABEL: Record<MeetingMode, string> = { ONLINE: "Online", IN_PERSON: "In person" };
const MODES: MeetingMode[] = ["ONLINE", "IN_PERSON"];

const LABEL = "mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink/45";
const INPUT =
  "w-full rounded-xl border border-ink/12 bg-white px-3 text-[15px] text-ink outline-none transition-colors placeholder:text-ink/35 focus:border-cyan-strong focus-visible:ring-2 focus-visible:ring-cyan-strong/25";

/** "10 min before", and the one that means no warning at all. */
function remindLabel(minutes: number) {
  return minutes === 0 ? "Only when it starts" : `${minutes} min before`;
}

function durationLabel(minutes: number) {
  return minutes < 60 ? `${minutes} min` : minutes === 60 ? "1 hour" : `${minutes / 60} hours`;
}

export function MeetingSheet({
  setup,
  initialTitle,
  onClose,
  onCreate,
}: {
  setup: MeetingSetup;
  initialTitle: string;
  onClose: () => void;
  /** Saves the meeting; throws with a reason the form can show. */
  onCreate: (formData: FormData) => Promise<void>;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const ids = useId();

  const [title, setTitle] = useState(initialTitle);
  const [agenda, setAgenda] = useState("");
  const [mode, setMode] = useState<MeetingMode>("ONLINE");
  const [place, setPlace] = useState("");
  // Everybody in the chat, the manager included: a meeting is the whole room
  // until somebody is taken out of it.
  const [attendees, setAttendees] = useState<string[]>(setup.members.map((member) => member.key));
  const [day, setDay] = useState(setup.defaultWhen.dayKey);
  const [time, setTime] = useState(setup.defaultWhen.time);
  const [duration, setDuration] = useState(30);
  const [remind, setRemind] = useState(10);
  const [saving, setSaving] = useState(false);
  // The reason, and the form as it stood when the reason was given.
  const [failure, setFailure] = useState<{ reason: string; form: string } | null>(null);

  const form = [title, agenda, mode, place, attendees.join(","), day, time, duration, remind].join("␟");
  const error = failure && failure.form === form ? failure.reason : null;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const everyone = setup.members.length > 1 && attendees.length === setup.members.length;

  function toggle(key: string) {
    setAttendees((current) => (current.includes(key) ? current.filter((one) => one !== key) : [...current, key]));
  }

  function close() {
    if (!saving) onClose();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const refuse = (reason: string) => setFailure({ reason, form });

    if (!title.trim()) return refuse("Give the meeting a name.");
    if (attendees.length === 0) return refuse("Choose who is coming.");
    // The same pure function the server uses, so the two never disagree.
    const when = readWhen(day, time, setup.timeZone, new Date());
    if (!when.ok) return refuse(when.reason);

    setFailure(null);
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set("title", title.trim());
      if (agenda.trim()) formData.set("agenda", agenda.trim());
      formData.set("mode", mode);
      if (mode === "IN_PERSON" && place.trim()) formData.set("place", place.trim());
      for (const key of attendees) formData.append("attendee", key);
      formData.set("day", day);
      formData.set("time", time);
      formData.set("duration", String(duration));
      formData.set("remind", String(remind));
      await onCreate(formData);
    } catch (cause) {
      refuse(cause instanceof Error && cause.message ? cause.message : "Could not set the meeting. Try again.");
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={`${ids}-heading`}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        // A tap on the dimmed page around it, not inside it.
        if (event.target === event.currentTarget) close();
      }}
      className="task-sheet mx-auto mb-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-3xl border-0 bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/40 sm:my-auto sm:max-w-lg sm:rounded-3xl"
    >
      <form onSubmit={submit} noValidate className="flex max-h-[92dvh] flex-col">
        <header className="flex items-center justify-between border-b border-ink/[0.07] px-5 py-3">
          <h2 id={`${ids}-heading`} className="text-base font-semibold">
            New meeting
          </h2>
          <button
            type="button"
            onClick={close}
            disabled={saving}
            aria-label="Close"
            className="-mr-2 flex h-10 w-10 items-center justify-center rounded-full text-ink/50 transition-colors hover:bg-ink/5 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/25"
          >
            <X size={19} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <div>
            <label htmlFor={`${ids}-title`} className={LABEL}>
              What is it about
            </label>
            <input
              id={`${ids}-title`}
              autoFocus
              value={title}
              maxLength={MEETING_TITLE_MAX}
              dir="auto"
              placeholder="Villa Al-Zu'bi review"
              aria-required
              onChange={(event) => setTitle(event.target.value)}
              className={cn(INPUT, "h-11")}
            />
          </div>

          <div>
            <label htmlFor={`${ids}-agenda`} className={LABEL}>
              What to cover <span className="font-normal normal-case tracking-normal text-ink/35">(optional)</span>
            </label>
            <textarea
              id={`${ids}-agenda`}
              rows={3}
              value={agenda}
              maxLength={MEETING_AGENDA_MAX}
              dir="auto"
              placeholder="The points to go through, what to bring…"
              onChange={(event) => setAgenda(event.target.value)}
              className={cn(INPUT, "resize-none py-2.5")}
            />
          </div>

          <fieldset>
            <legend className={LABEL}>Where</legend>
            <div role="radiogroup" aria-label="Where" className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1">
              {MODES.map((one, index) => {
                const chosen = mode === one;
                return (
                  <button
                    key={one}
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    tabIndex={chosen ? 0 : -1}
                    onClick={() => setMode(one)}
                    onKeyDown={(event) => {
                      const step =
                        event.key === "ArrowRight" || event.key === "ArrowDown"
                          ? 1
                          : event.key === "ArrowLeft" || event.key === "ArrowUp"
                            ? -1
                            : 0;
                      if (!step) return;
                      event.preventDefault();
                      const next = (index + step + MODES.length) % MODES.length;
                      setMode(MODES[next]);
                      const group = event.currentTarget.parentElement;
                      (group?.children[next] as HTMLButtonElement | undefined)?.focus();
                    }}
                    className={cn(
                      "h-9 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/40",
                      chosen ? "bg-white text-ink shadow-sm" : "text-ink/55 hover:text-ink/80"
                    )}
                  >
                    {MODE_LABEL[one]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-xs text-ink/45">
              {mode === "ONLINE"
                ? "The card carries a Join button when it starts."
                : "Everybody comes to the place you name."}
            </p>
          </fieldset>

          {mode === "IN_PERSON" && (
            <div>
              <label htmlFor={`${ids}-place`} className={LABEL}>
                Place
              </label>
              <input
                id={`${ids}-place`}
                value={place}
                maxLength={MEETING_PLACE_MAX}
                dir="auto"
                placeholder="The studio, the site, the client's office…"
                onChange={(event) => setPlace(event.target.value)}
                className={cn(INPUT, "h-11")}
              />
            </div>
          )}

          <fieldset>
            <legend className={LABEL}>Who is coming</legend>
            <div className="flex flex-wrap gap-2">
              {setup.members.length > 1 && (
                <button
                  type="button"
                  aria-pressed={everyone}
                  onClick={() => setAttendees(everyone ? [] : setup.members.map((member) => member.key))}
                  className={chip(everyone)}
                >
                  Everyone
                  {everyone && <Check size={14} strokeWidth={2.75} aria-hidden />}
                </button>
              )}
              {setup.members.map((member) => {
                const chosen = attendees.includes(member.key);
                return (
                  <button
                    key={member.key}
                    type="button"
                    aria-pressed={chosen}
                    onClick={() => toggle(member.key)}
                    className={cn(chip(chosen), "pl-1")}
                  >
                    <PersonAvatar name={member.name} color={member.color} size={24} />
                    {member.name}
                    {chosen && <Check size={14} strokeWidth={2.75} aria-hidden />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${ids}-day`} className={LABEL}>
                Day
              </label>
              <input
                id={`${ids}-day`}
                type="date"
                value={day}
                min={setup.today}
                aria-required
                onChange={(event) => setDay(event.target.value)}
                className={cn(INPUT, "h-11")}
              />
            </div>
            <div>
              <label htmlFor={`${ids}-time`} className={LABEL}>
                Starts
              </label>
              <input
                id={`${ids}-time`}
                type="time"
                value={time}
                step={300}
                aria-required
                onChange={(event) => setTime(event.target.value)}
                className={cn(INPUT, "h-11")}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor={`${ids}-duration`} className={LABEL}>
                How long
              </label>
              <select
                id={`${ids}-duration`}
                value={duration}
                onChange={(event) => setDuration(Number(event.target.value))}
                className={cn(INPUT, "h-11")}
              >
                {DURATION_CHOICES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {durationLabel(minutes)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`${ids}-remind`} className={LABEL}>
                Tell everyone
              </label>
              <select
                id={`${ids}-remind`}
                value={remind}
                onChange={(event) => setRemind(Number(event.target.value))}
                className={cn(INPUT, "h-11")}
              >
                {REMIND_CHOICES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {remindLabel(minutes)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p role="alert" className="neon-rise rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>

        <footer className="flex gap-2 border-t border-ink/[0.07] px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
          <button type="button" onClick={close} disabled={saving} className={buttonClasses("outline", "md", "flex-1")}>
            Cancel
          </button>
          <button type="submit" disabled={saving} className={buttonClasses("primary", "md", "flex-1")}>
            {saving ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}
            {saving ? "Setting…" : "Set meeting"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function chip(chosen: boolean) {
  return cn(
    "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium ring-1 transition-[background-color,color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong/50",
    chosen ? "bg-ink text-bg ring-ink" : "bg-white text-ink/70 ring-ink/12 hover:bg-ink/[0.03]"
  );
}
