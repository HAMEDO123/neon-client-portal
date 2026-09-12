"use client";

import { useEffect, useState } from "react";
import { useMinuteNow } from "@/lib/use-minute-now";
import { DEFAULT_TIMEZONE, dayKeyIn } from "@/lib/time";
import { countdownToDay } from "@/lib/stage-schedule";
import { dayOfWindow, windowFraction, windowLabel } from "@/lib/progress";
import { cn } from "@/lib/utils";

// How much of a task's time has gone, as a bar.
//
// A meter: the fill carries how things stand — the accent while there is room,
// amber when the deadline is close, pink once it has passed — and the track is
// a lighter step of the same colour, so the state reads across the whole bar
// rather than only at its end. The words underneath say it too, so it never
// rests on colour alone.
//
// Grows in from empty when it appears, and recounts itself every minute. It
// holds its space before mounting so the card does not jump.

const TONES = {
  calm: { track: "bg-cyan/15", fill: "bg-cyan-strong" },
  soon: { track: "bg-amber-500/15", fill: "bg-amber-500" },
  late: { track: "bg-pink/15", fill: "bg-pink" },
} as const;

export function DeadlineMeter({
  startKey,
  endKey,
  timeZone = DEFAULT_TIMEZONE,
  showLabel = true,
}: {
  startKey: string;
  endKey: string;
  timeZone?: string;
  /** Off where a countdown chip beside it already says the same thing. */
  showLabel?: boolean;
}) {
  const minute = useMinuteNow();
  const [grown, setGrown] = useState(false);

  // Grown on the next frame rather than this one, so the bar fills in from
  // empty instead of appearing already full.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setGrown(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!minute) return <div className={showLabel ? "mt-3 h-[22px]" : "mt-2.5 h-1.5"} aria-hidden />;
  const now = new Date(minute);

  const window = dayOfWindow(startKey, endKey, dayKeyIn(timeZone, now));
  const tone = TONES[countdownToDay(endKey, now, timeZone).tone];
  const fraction = windowFraction(window);
  const label = windowLabel(window);

  return (
    <div className={showLabel ? "mt-3" : "mt-2.5"}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={window.total}
        aria-valuenow={window.day}
        className={cn("h-1.5 overflow-hidden rounded-full", tone.track)}
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-700 ease-out", tone.fill)}
          style={{ width: `${grown ? fraction * 100 : 0}%` }}
        />
      </div>
      {/* The bar carries the label only where it stands alone: on a card, the
          countdown chip beside the title has already said it. */}
      {showLabel && <p className="mt-1 text-[11px] font-medium text-ink/45">{label}</p>}
    </div>
  );
}
