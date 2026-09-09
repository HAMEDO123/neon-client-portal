"use client";

import { useEffect, useState } from "react";
import { AlarmClock, TimerReset } from "lucide-react";
import { countdownOf } from "@/lib/stage-schedule";
import { cn } from "@/lib/utils";

// How long is left on this stage.
//
// The number is what the employee actually acts on — "two days" is a decision,
// "due 11 September" is a lookup — so it is the thing on the card, and it
// recalculates itself rather than going stale in an app somebody left open
// overnight. It renders nothing until mounted, because a countdown computed on
// the server and one computed in the phone's timezone can disagree by a day
// and React would call that a hydration error.

const TONES = {
  calm: "border-ink/10 bg-ink/[0.04] text-ink/55",
  soon: "border-amber-500/25 bg-amber-500/10 text-amber-700",
  late: "border-pink/25 bg-pink/10 text-pink-strong",
} as const;

export function Countdown({
  dueBy,
  size = "small",
  className,
}: {
  /** ISO string; the component owns the arithmetic. */
  dueBy: string;
  size?: "small" | "large";
  className?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    // A minute is fine: nothing here changes faster than that.
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (!now) return null;

  const due = new Date(dueBy);
  if (Number.isNaN(due.getTime())) return null;

  const countdown = countdownOf(due, now);
  const Icon = countdown.overdue ? AlarmClock : TimerReset;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        size === "large" ? "px-3 py-1.5 text-sm" : "px-2 py-0.5 text-[11px]",
        TONES[countdown.tone],
        className
      )}
      title={`Due ${due.toLocaleDateString()}`}
    >
      <Icon size={size === "large" ? 15 : 11} strokeWidth={2.25} />
      {countdown.label}
    </span>
  );
}
