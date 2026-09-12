"use client";

import { useState, useTransition } from "react";
import { CircleAlert, CirclePause, Clock, Play } from "lucide-react";
import { answerFollowUp } from "@/lib/actions/follow-up-actions";
import { cn } from "@/lib/utils";

// The day asked something; this is where it is answered.
//
// The buttons live on the page rather than inside the notification on purpose:
// iOS does not draw action buttons on a web push at all, so a reply that only
// existed there would simply not exist on half the phones in the studio. The
// notification opens this page; one tap here is the whole answer.

const CHOICES: Record<
  string,
  { value: string; label: string; icon: typeof Play; tone: string; asks?: string }[]
> = {
  "block-start": [
    { value: "started", label: "Started", icon: Play, tone: "border-emerald-500/30 text-emerald-700" },
    {
      value: "need-info",
      label: "Need information",
      icon: CircleAlert,
      tone: "border-amber-500/30 text-amber-700",
      asks: "What do you need?",
    },
    {
      value: "blocked",
      label: "Blocked",
      icon: CirclePause,
      tone: "border-pink/30 text-pink-strong",
      asks: "What is in the way?",
    },
    {
      value: "more-time",
      label: "Needs more time",
      icon: Clock,
      tone: "border-ink/20 text-ink/70",
      asks: "How much longer?",
    },
  ],
  "block-end": [
    { value: "done", label: "Done", icon: Play, tone: "border-emerald-500/30 text-emerald-700" },
    {
      value: "partly",
      label: "Partly done",
      icon: Clock,
      tone: "border-amber-500/30 text-amber-700",
      asks: "What is left?",
    },
    {
      value: "blocked",
      label: "Blocked",
      icon: CirclePause,
      tone: "border-pink/30 text-pink-strong",
      asks: "What is in the way?",
    },
    {
      value: "not-started",
      label: "Not started",
      icon: CircleAlert,
      tone: "border-ink/20 text-ink/70",
      asks: "What happened?",
    },
  ],
};

const ASKED: Record<string, string> = {
  "block-start": "This was due to start now.",
  "block-middle": "About halfway — how is it going?",
  "block-end": "This was planned to finish about now.",
};

export function FollowUpReply({
  followUpId,
  kind,
}: {
  followUpId: string;
  kind: string;
}) {
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState<{ value: string; asks: string } | null>(null);
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choices = CHOICES[kind] ?? CHOICES["block-start"];

  function send(value: string, text?: string) {
    setError(null);
    start(async () => {
      try {
        const result = await answerFollowUp(followUpId, value, text);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setDone(value);
        setAsking(null);
        setNote("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not send.");
      }
    });
  }

  if (done) {
    return (
      <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.07] p-4">
        <p className="text-sm font-medium text-emerald-800">Thanks — that is recorded.</p>
        <p className="mt-0.5 text-xs text-emerald-800/70">The manager can see it on the board.</p>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-ink/10 bg-white/70 p-4">
      <p className="text-sm font-medium text-ink">{ASKED[kind] ?? "How is this going?"}</p>

      {!asking && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              disabled={pending}
              onClick={() => (choice.asks ? setAsking({ value: choice.value, asks: choice.asks }) : send(choice.value))}
              className={cn(
                "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border bg-white px-3 text-sm font-medium disabled:opacity-50",
                choice.tone
              )}
            >
              <choice.icon size={15} strokeWidth={2} />
              {choice.label}
            </button>
          ))}
        </div>
      )}

      {asking && (
        <div className="mt-3">
          <label className="block text-xs font-medium text-ink/50" htmlFor="follow-up-note">
            {asking.asks}
          </label>
          <textarea
            id="follow-up-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            rows={2}
            dir="auto"
            className="mt-1 w-full rounded-xl border border-ink/12 bg-white px-3 py-2 text-sm outline-none focus:border-cyan-strong"
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => send(asking.value, note)}
              className="min-h-11 flex-1 rounded-xl bg-ink px-3 text-sm font-medium text-bg disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send"}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => setAsking(null)}
              className="min-h-11 rounded-xl border border-ink/12 px-3 text-sm text-ink/60"
            >
              Back
            </button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}
    </section>
  );
}
