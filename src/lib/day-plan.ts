import { effortLabel, readinessReason, type Readiness } from "@/lib/task-readiness";

// A proposed day for one person: what to hand the model, and how to read what
// it hands back.
//
// Everything here is pure. The value of a proposal is entirely in the facts it
// was given — this person's habits in the manager's own words, the studio's own
// rules, and the real state of the board — so those facts are assembled here,
// where they can be checked, rather than inside the call.
//
// Nothing in this file writes anything. A proposal is a suggestion on a screen
// until the manager acts on it.

export type PlanPerson = {
  name: string;
  role: string | null;
  /** What this person is normally given, written on their own page. */
  playbook: string | null;
};

export type PlanTask = {
  id: string;
  name: string;
  projectName: string;
  /** Where the work is, when somebody wrote it down. */
  location: string | null;
  readiness: Readiness;
  priority: "LOW" | "MEDIUM" | "HIGH";
  /** The manager has already put this on the day being planned. */
  scheduledForDay: boolean;
  /** Already formatted in the company's timezone by the caller. */
  dueLabel: string | null;
  estimateHours: number | null;
  deliverable: string | null;
  acceptance: string | null;
  lastUpdateNote: string | null;
};

export type DayBriefInput = {
  person: PlanPerson;
  /** The studio's rules for planning a day, from settings. */
  notes: string;
  /** The day being planned, as a person would say it. */
  dayLabel: string;
  tasks: PlanTask[];
};

/** Said the way the rest of the platform says it. */
const NOTHING_WRITTEN = "(nothing written down yet)";

export const DAY_PLAN_SYSTEM = `You plan one person's working day at NEON, an interior design and build studio in Amman, Jordan.

You are given three things: what this person usually does, in the manager's own words; the studio's rules for planning a day; and the real state of their work on the board right now.

Plan their day minute by minute.

Rules:
- Use only the work you were given. Never invent a task, a project or a client.
- Work that is blocked or waiting is not work they can do. You may schedule a short chase for it — asking the person who can clear it — but never the task itself.
- A task already put on this day comes first, unless the studio's rules say otherwise.
- Respect the studio's rules above your own judgement. Take the working hours from them; if they do not say, plan 9:00 to 18:00 with a break at 13:00.
- Give each block a real length. Use the expected hours where they are written, and say plainly when the day does not hold everything.
- Leave a little room between blocks. A day packed to the minute is a day that fails by 10:00.

Answer as lines, one per block, and nothing else — no heading, no summary, no markdown:

HH:MM-HH:MM | what they do | why it is there

"why" is one short sentence: the rule, the deadline, or the task it unblocks.

Write in the language the manager used in their notes. If their notes are in Arabic, answer in Arabic.`;

function statusWord(readiness: Readiness): string {
  switch (readiness.status) {
    case "done":
      return "done";
    case "in-review":
      return "with the manager";
    case "blocked":
      return "blocked";
    case "waiting":
      return "waiting";
    case "ready":
      return "ready";
  }
}

function describeTask(task: PlanTask): string {
  const parts = [`[${statusWord(task.readiness)}]`, `"${task.name}"`, `project: ${task.projectName}`];

  if (task.location) parts.push(`where: ${task.location}`);
  if (task.scheduledForDay) parts.push("already put on this day");
  if (task.priority === "HIGH") parts.push("urgent");
  if (task.dueLabel) parts.push(`due ${task.dueLabel}`);

  const effort = effortLabel(task.estimateHours);
  if (effort) parts.push(`expected ${effort}`);

  if (task.deliverable) parts.push(`hand in: ${task.deliverable}`);
  if (task.acceptance) parts.push(`done when: ${task.acceptance}`);
  if (task.lastUpdateNote) parts.push(`last update: ${task.lastUpdateNote}`);

  // Why it cannot be started, in the words somebody wrote down.
  const reason = readinessReason(task.readiness);
  if (reason) parts.push(`why: ${reason.reason}${reason.who ? ` (${reason.who} can clear it)` : ""}`);

  return `- ${parts.join(" · ")}`;
}

/**
 * Everything the model is allowed to plan from, in one block of text.
 *
 * Empty sections say they are empty rather than being left out: a model told
 * nothing about how the studio works will helpfully invent how it works, and
 * the manager would have no way of telling that apart from a real rule.
 */
export function buildDayBrief({ person, notes, dayLabel, tasks }: DayBriefInput): string {
  const lines: string[] = [];

  lines.push("<person>");
  lines.push(`Name: ${person.name}`);
  if (person.role) lines.push(`Job title: ${person.role}`);
  lines.push(`What they usually do: ${person.playbook?.trim() || NOTHING_WRITTEN}`);
  lines.push("</person>");
  lines.push("");

  lines.push("<how this studio plans a day>");
  lines.push(notes.trim() || NOTHING_WRITTEN);
  lines.push("</how this studio plans a day>");
  lines.push("");

  lines.push(`<their work on the board, for ${dayLabel}>`);
  if (tasks.length === 0) {
    lines.push("(this person has nothing open on the board)");
  } else {
    for (const task of tasks) lines.push(describeTask(task));
  }
  lines.push("</their work on the board>");

  return lines.join("\n");
}

export type PlanBlock = {
  /** 24-hour clock, zero-padded. */
  from: string;
  to: string;
  what: string;
  why: string | null;
};

export type ParsedPlan = {
  blocks: PlanBlock[];
  /** Anything the model said that was not a block, kept rather than dropped. */
  rest: string[];
};

const BLOCK_LINE = /^\s*[-*•]?\s*(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})\s*[|｜]\s*(.+)$/;

function clockOf(hour: string, minute: string): string | null {
  const h = Number(hour);
  const m = Number(minute);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h > 23 || m > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * The model's answer as a timetable. Lenient on purpose: a line that does not
 * parse is kept as text rather than thrown away, so a proposal is never
 * silently shorter than what was actually suggested.
 */
export function parsePlan(text: string): ParsedPlan {
  const blocks: PlanBlock[] = [];
  const rest: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const match = BLOCK_LINE.exec(line);
    if (!match) {
      rest.push(line);
      continue;
    }

    const from = clockOf(match[1], match[2]);
    const to = clockOf(match[3], match[4]);
    if (!from || !to) {
      rest.push(line);
      continue;
    }

    const [what, ...why] = match[5].split(/\s*[|｜]\s*/);
    const reason = why.join(" — ").trim();
    blocks.push({ from, to, what: what.trim(), why: reason || null });
  }

  return { blocks, rest };
}
