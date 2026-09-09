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

// A click cycles a cell forward, so checking a task off stays a single click
// and deferring it is two. IN_PROGRESS is set by employees from their own
// portal rather than by cycling, so the admin cycle skips past it to DONE and
// the board's existing three-click rhythm is unchanged.
export const NEXT_STATE: Record<TaskState, TaskState> = {
  TODO: "DONE",
  IN_PROGRESS: "DONE",
  // A submitted task is the employee's claim that it is finished; the manager
  // ticking the cell is them accepting it.
  SUBMITTED: "DONE",
  DONE: "TOMORROW",
  TOMORROW: "TODO",
};

export const STATE_LABEL: Record<TaskState, string> = {
  TODO: "To do",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Awaiting review",
  DONE: "Done",
  TOMORROW: "Tomorrow",
};

// The same states as an employee sees them (spec: Pending / In Progress /
// Completed). TOMORROW stays an admin planning marker and reads as pending
// work that is not for today.
export const EMPLOYEE_STATE_LABEL: Record<TaskState, string> = {
  TODO: "Pending",
  IN_PROGRESS: "In progress",
  SUBMITTED: "Sent for review",
  DONE: "Completed",
  TOMORROW: "Planned for tomorrow",
};

// The statuses an employee can set with a tap. Completion is not among them:
// finishing a task means sending evidence for review, which is a different
// action with a photo attached.
export const EMPLOYEE_SETTABLE_STATES: TaskState[] = ["TODO", "IN_PROGRESS"];

export const PRIORITY_LABEL = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
} as const;

// The unassigned bucket is a real column group on the board but has no
// Employee row behind it, so it gets a reserved id instead.
export const UNASSIGNED_ID = "unassigned";
