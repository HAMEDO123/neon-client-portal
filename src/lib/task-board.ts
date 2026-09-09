import type { TaskState } from "@/generated/prisma/enums";

// Accent colors an employee column group can be tinted with. Kept to the NEON
// palette so the board reads as part of the same design system.
export const EMPLOYEE_COLORS = ["cyan", "purple", "pink", "orange"] as const;

export type EmployeeColor = (typeof EMPLOYEE_COLORS)[number];

const HEADER_TONES: Record<EmployeeColor, string> = {
  cyan: "bg-cyan/10 text-cyan-strong",
  purple: "bg-purple/10 text-purple-strong",
  pink: "bg-pink/10 text-pink-strong",
  orange: "bg-orange/10 text-orange-strong",
};

const COLUMN_TONES: Record<EmployeeColor, string> = {
  cyan: "bg-cyan/[0.04]",
  purple: "bg-purple/[0.04]",
  pink: "bg-pink/[0.04]",
  orange: "bg-orange/[0.04]",
};

const DOT_TONES: Record<EmployeeColor, string> = {
  cyan: "bg-cyan",
  purple: "bg-purple",
  pink: "bg-pink",
  orange: "bg-orange",
};

function asColor(color: string): EmployeeColor {
  return (EMPLOYEE_COLORS as readonly string[]).includes(color) ? (color as EmployeeColor) : "cyan";
}

export function headerTone(color: string) {
  return HEADER_TONES[asColor(color)];
}

export function columnTone(color: string) {
  return COLUMN_TONES[asColor(color)];
}

export function dotTone(color: string) {
  return DOT_TONES[asColor(color)];
}

// A click cycles a cell forward through the three states, so checking a task
// off is a single click and deferring it is two.
export const NEXT_STATE: Record<TaskState, TaskState> = {
  TODO: "DONE",
  DONE: "TOMORROW",
  TOMORROW: "TODO",
};

export const STATE_LABEL: Record<TaskState, string> = {
  TODO: "To do",
  DONE: "Done",
  TOMORROW: "Tomorrow",
};

// The unassigned bucket is a real column group on the board but has no
// Employee row behind it, so it gets a reserved id instead.
export const UNASSIGNED_ID = "unassigned";
