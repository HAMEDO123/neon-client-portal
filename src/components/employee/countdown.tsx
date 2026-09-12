"use client";

import { AlarmClock, TimerReset } from "lucide-react";
import { useMinuteNow } from "@/lib/use-minute-now";
import { countdownOf, countdownToDay } from "@/lib/stage-schedule";
import { cn } from "@/lib/utils";

// How long is left.
//
// The number is what the employee actually acts on — "two days" is a decision,
// "due 11 September" is a lookup — so it is the thing on the card, and it
// recalculates itself rather than going stale in an app somebody left open
// overnight. It counts calendar days in the company's timezone: a job due this
// afternoon is due today, however many hours remain.
//
// It renders nothing until mounted, because a countdown computed on the server
// and one computed on the phone can land either side of midnight and React
// would call that a hydration error.

const TONES = {
  calm: "border-ink/10 bg-ink/[0.04] text-ink/55",
  soon: "border-amber-500/25 bg-amber-500/10 text-amber-700",
  late: "border-pink/25 bg-pink/10 text-pink-strong",
} as const;

export function Countdown({
  dueBy,
  dueDay,
  timeZone,
  size = "small",
  className,
}: {
  /** An instant, as ISO — a stage's deadline. */
  dueBy?: string;
  /** A calendar day, YYYY-MM-DD — a job due by the end of that day. */
  dueDay?: string;
  /** The company's timezone, so "today" is the same day for everyone. */
  timeZone?: string;
  size?: "small" | "large";
  className?: string;
}) {
  const minute = useMinuteNow();
  if (!minute) return null;
  const now = new Date(minute);

  let countdown;
  if (dueDay) {
    countdown = countdownToDay(dueDay, now, timeZone);
  } else if (dueBy) {
    const due = new Date(dueBy);
    if (Number.isNaN(due.getTime())) return null;
    countdown = countdownOf(due, now, timeZone);
  } else {
    return null;
  }

  const Icon = countdown.overdue ? AlarmClock : TimerReset;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        size === "large" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]",
        TONES[countdown.tone],
        className
      )}
    >
      <Icon size={size === "large" ? 15 : 11} strokeWidth={2.25} />
      {countdown.label}
    </span>
  );
}
