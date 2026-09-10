"use client";

import { useEffect, useState } from "react";
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
}: {
  startKey: string;
  endKey: string;
  timeZone?: string;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const [grown, setGrown] = useState(false);

  useEffect(() => {
    setNow(new Date());
    const frame = requestAnimationFrame(() => setGrown(true));
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
    };
  }, []);

  if (!now) return <div className="mt-3 h-[22px]" aria-hidden />;

  const window = dayOfWindow(startKey, endKey, dayKeyIn(timeZone, now));
  const tone = TONES[countdownToDay(endKey, now, timeZone).tone];
  const fraction = windowFraction(window);
  const label = windowLabel(window);

  return (
    <div className="mt-3">
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
      <p className="mt-1 text-[11px] font-medium text-ink/45">{label}</p>
    </div>
  );
}
