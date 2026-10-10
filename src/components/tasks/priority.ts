// What a task's priority looks like, wherever a task is drawn.
//
// The studio asked for the whole task to wear its priority, not only the word:
// a high priority is red from across the room. It was one small pink chip on a
// card otherwise identical to every other, which is the one thing on the
// screen that is supposed to be noticed first.
//
// One place, because the manager's week and the team's own list have to mean
// the same thing by a colour — the manager sets it on one and it is read on
// the other.
//
// Medium is deliberately not a colour. It is what a task is when nobody chose,
// which is nearly all of them, and a list where every card is tinted is a list
// where the red ones stop standing out.

type Priority = "LOW" | "MEDIUM" | "HIGH";

/**
 * A card built on `.glass`. These are classes of their own in globals.css
 * rather than utilities: `.glass` sets its background outside any layer, and a
 * `bg-*` class cannot override that.
 */
export const PRIORITY_CARD: Record<Priority, string> = {
  HIGH: "task-high",
  MEDIUM: "",
  LOW: "task-low",
};

/** A plain bordered row, such as the list under "Assign a task". */
export const PRIORITY_ROW: Record<Priority, string> = {
  HIGH: "border-red-500/45 bg-red-100/80 active:bg-red-100",
  MEDIUM: "border-ink/8 bg-white/70 active:bg-white",
  LOW: "border-slate-400/25 bg-slate-100/70 active:bg-slate-100",
};

/** A job's bar on the week board. */
export const PRIORITY_BAR: Record<Priority, string> = {
  HIGH: "bg-red-500/20 border-red-500/50 text-red-800",
  MEDIUM: "bg-cyan/15 border-cyan/35 text-cyan-strong",
  LOW: "bg-ink/[0.06] border-ink/15 text-ink/60",
};

/** The word itself, where it is written out on a card that is already coloured. */
export const PRIORITY_CHIP: Record<Priority, string> = {
  HIGH: "border-red-600 bg-red-600 text-white",
  MEDIUM: "border-orange/20 bg-orange/10 text-orange-strong",
  LOW: "border-ink/10 bg-ink/5 text-ink/50",
};
