// What a kind of work needs, written once instead of on every project.
//
// A step of the process — "3D render", "site visit", "BOQ" — is the same job
// whatever project it sits on: the same thing to hand in, the same meaning of
// finished, roughly the same hours, the same proof. Until now all of that was
// typed onto each cell of the board, which meant typing it again for every
// project or, far more often, not at all — and a cell with nothing written on
// it cannot be checked against anything, so the check gives up and waits for a
// person.
//
// So the standard lives on the step, and the cell keeps the right to differ.
// That is the same shape as ownership (a standing owner on the step, an
// override on the cell): the pattern this codebase already uses for "usually
// this, unless somebody said otherwise".
//
// Pure on purpose. Every rule here is about which of two written things applies
// and what a written thing amounts to; none of it needs a database to decide.

import type { Policy } from "@/lib/verification";

/** The standard for one kind of work. Every field is optional. */
export type TaskType = {
  /** What is handed in. */
  deliverable: string | null;
  /** What counts as finished, one criterion per line. */
  acceptance: string | null;
  /** What it should take, in hours. */
  estimateHours: number | null;
  /** What proof is expected — a photo of the screen, the PDF, the link. */
  evidence: string | null;
  /** The steps to follow while doing it, one per line. */
  checklist: string | null;
  /** Whether work of this kind may be accepted without a person looking. */
  autoAccept: boolean;
  /** Who normally reviews it. */
  reviewerId: string | null;
};

/** What one cell of the board says for itself. */
export type CellDetail = {
  deliverable: string | null;
  acceptance: string | null;
  estimateHours: number | null;
};

/** A value, and whether it was written here or inherited. */
export type Inherited<T> = { value: T; from: "cell" | "step" | null };

/**
 * Text that somebody actually wrote.
 *
 * An empty box is not an override. A cell whose acceptance field was opened and
 * left blank must inherit the step's, not silently erase it — otherwise
 * clearing a field would quietly turn off the check on that cell.
 */
function written(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Hours that mean something. Zero is not an estimate, and nor is a negative. */
function hours(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function inheritText(own: string | null | undefined, standard: string | null | undefined): Inherited<string | null> {
  const mine = written(own);
  if (mine) return { value: mine, from: "cell" };

  const theirs = written(standard);
  return theirs ? { value: theirs, from: "step" } : { value: null, from: null };
}

export function inheritHours(own: number | null | undefined, standard: number | null | undefined): Inherited<number | null> {
  const mine = hours(own);
  if (mine !== null) return { value: mine, from: "cell" };

  const theirs = hours(standard);
  return theirs !== null ? { value: theirs, from: "step" } : { value: null, from: null };
}

export type EffectiveDetail = {
  deliverable: Inherited<string | null>;
  acceptance: Inherited<string | null>;
  estimateHours: Inherited<number | null>;
};

/**
 * What actually applies to one cell: its own words where it has them, the
 * step's standard where it does not.
 *
 * Each answer carries where it came from, so a screen can say "from the step"
 * rather than presenting an inherited value as though somebody typed it here.
 */
export function effectiveDetail(
  cell: Partial<CellDetail> | null | undefined,
  step: Partial<TaskType> | null | undefined
): EffectiveDetail {
  return {
    deliverable: inheritText(cell?.deliverable, step?.deliverable),
    acceptance: inheritText(cell?.acceptance, step?.acceptance),
    estimateHours: inheritHours(cell?.estimateHours, step?.estimateHours),
  };
}

/**
 * A written block as separate things, one per line.
 *
 * The same reading everywhere: the criteria a submission is checked against, the
 * checklist somebody follows, and the proof they are asked for are all "a list
 * the manager typed", and they must not be read three different ways. Bullets
 * and numbering are stripped because people type them; a line of one character
 * is not an item.
 */
export function linesOf(text: string | null | undefined, max = 12): string[] {
  return (text ?? "")
    .split(/\r?\n|·|;/)
    .map((line) => line.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((line) => line.length > 1)
    .slice(0, max);
}

/**
 * Whether work of this kind may be accepted without a person looking.
 *
 * The switch alone is not enough: there must be something written to check it
 * against. "Accept automatically" on a step whose acceptance nobody wrote would
 * mean accepting every claim of finished work on that step, for ever, on no
 * evidence at all — the one setting in this system that could do real damage
 * quietly, so it is refused here rather than trusted.
 *
 * What is handed in (`deliverable`) deliberately does not count. It says what to
 * send, not what makes it right, and skipping a person needs the second.
 */
export function mayAutoAccept(step: Partial<TaskType> | null | undefined): boolean {
  if (!step?.autoAccept) return false;
  return linesOf(step.acceptance).length > 0;
}

/** The policy `lib/verification.ts` decides an outcome with. */
export function policyFor(step: Partial<TaskType> | null | undefined): Policy {
  return { autoAccept: mayAutoAccept(step) };
}

/**
 * What a step's standard amounts to, in short phrases for a list.
 *
 * Kept here rather than in the component so it can be checked: a settings screen
 * that says "3 checks" when there are two is worse than one that says nothing.
 */
export function summaryOf(step: Partial<TaskType> | null | undefined): string[] {
  const parts: string[] = [];

  const criteria = linesOf(step?.acceptance).length;
  if (criteria > 0) parts.push(`${criteria} ${criteria === 1 ? "check" : "checks"}`);

  const steps = linesOf(step?.checklist).length;
  if (steps > 0) parts.push(`${steps}-point checklist`);

  if (written(step?.evidence)) parts.push("proof required");

  const estimate = hours(step?.estimateHours);
  if (estimate !== null) parts.push(`${estimate}h`);

  if (step?.reviewerId) parts.push("has a reviewer");
  if (mayAutoAccept(step)) parts.push("accepted automatically");

  return parts;
}
