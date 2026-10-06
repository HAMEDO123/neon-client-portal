import { dayKeyToDate, shiftDayKey } from "./time";
import { daysBetween } from "./week";

// Handing work out by saying it.
//
// The manager talks — "Wael today: one, call the supplier, two, send the villa
// drawings… and Sally tomorrow…" — and each thing asked for becomes a job for
// the person named, on the day named. This is the pure half: what the model is
// told, the shape it must answer in, and the reading of that answer into
// drafts. Nothing here talks to the model or the database, so the rules that
// matter can be pinned by tests.
//
// **Nothing is handed out by this module, or by the model.** What comes back
// is a list of drafts the manager reads, corrects and then sends. Speech
// recognition mishears names, and a job landing on the wrong person's phone —
// with a notification — is the one way this could do harm. The same reason the
// rules engine ships with a preview.
//
// **A name that matches nobody is said, never guessed.** The model is given
// the team by id and may only answer with one of those ids; anything it cannot
// place comes back under `unplaced` with what was said and why, and the screen
// shows it. A job quietly given to the nearest-sounding name would be worse
// than one that was not created.

export type DictationPerson = { id: string; name: string; role: string | null };

export type DraftPriority = "LOW" | "MEDIUM" | "HIGH";

export type TaskDraft = {
  employeeId: string;
  title: string;
  /** How, where, with whom — only what was actually said. */
  note: string | null;
  /** What counts as finished, when the manager said so. Never invented. */
  acceptance: string | null;
  startKey: string;
  endKey: string;
  priority: DraftPriority;
};

/** Something that was said and could not be turned into a job, and why. */
export type Unplaced = { said: string; why: string };

export type Dictation = { drafts: TaskDraft[]; unplaced: Unplaced[] };

/** The most that is read in one go. Longer than this is several briefings, not one. */
export const MAX_WORDS = 8000;
/** A day's work for a studio is nowhere near this; it is a ceiling against a runaway answer. */
export const MAX_DRAFTS = 60;
/** How far ahead a spoken day may land. Past this it is a slip, not a plan. */
export const HORIZON_DAYS = 60;

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES: DraftPriority[] = ["LOW", "MEDIUM", "HIGH"];

export const DICTATION_SYSTEM = `You turn what a studio manager said into separate tasks for the people on their team.

The words usually come from speech recognition of spoken Arabic (Jordanian dialect), sometimes English or a mix. Expect no punctuation, misheard words, and names spelled in Arabic while the team list spells them in English.

How to read it:
- One task per distinct piece of work. Spoken counters ("واحد، اثنين، ثلاثة", "أول شي", "one, two") separate tasks; they are not part of a task.
- Each task belongs to the person named before it, until another person is named.
- Match a spoken name to the team list by sound across Arabic and English spelling (وائل = Wael, سالي = Sally). Use only ids from the list.
- If a name matches nobody on the list, or work is given to nobody in particular, do not guess: put it under "unplaced" with the words that were said and a short reason. If two people could be meant, that is unplaced too.
- "الكل", "الجميع", "everyone" means one task for each person on the list.

Days:
- No day mentioned means today.
- "بكرة", "بكرا", "غداً", "tomorrow" means the day the brief calls tomorrow.
- A weekday name means the next such day in the calendar given. A range ("من الأحد للثلاثاء") sets start_day and end_day; otherwise they are the same day.
- Use only dates from the calendar in the brief.

Each task:
- title: short and direct, in the language the manager used — never translate. Fix obvious recognition slips, keep names of clients, places and projects as said.
- details: anything else that was said about how, where, when or with whom. null when nothing more was said.
- done_when: null unless the manager stated a condition for it being finished or something to hand in ("يبعثلي صورة", "لازم العميل يوقّع", "send me the PDF"). Restating the task ("the renders are finished") is not a condition — leave it null. Something to hand in belongs here, not in details.
- priority: HIGH only when urgency was said ("ضروري", "مستعجل", "أهم شي", "urgent"); LOW only when it was said to be when there is time ("إذا فضي", "على مهله"); otherwise MEDIUM.

Never add work that was not asked for, and never drop work that was. If nothing in the words is a task, return no tasks and one "unplaced" entry saying so.`;

/**
 * The shape the answer must take.
 *
 * The ids are an enum of the real team, so an answer naming somebody who does
 * not exist cannot be produced at all — the model's only way to deal with an
 * unknown name is the honest one, `unplaced`.
 */
export function dictationSchema(personIds: string[]): Record<string, unknown> {
  const text = { type: "string" };
  const optional = { anyOf: [{ type: "string" }, { type: "null" }] };

  return {
    type: "object",
    additionalProperties: false,
    required: ["tasks", "unplaced"],
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["person_id", "title", "details", "done_when", "start_day", "end_day", "priority"],
          properties: {
            person_id: { type: "string", enum: personIds },
            title: text,
            details: optional,
            done_when: optional,
            start_day: { type: "string", description: "YYYY-MM-DD, from the calendar in the brief" },
            end_day: { type: "string", description: "YYYY-MM-DD; the same as start_day for a one-day task" },
            priority: { type: "string", enum: PRIORITIES },
          },
        },
      },
      unplaced: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["said", "why"],
          properties: { said: text, why: text },
        },
      },
    },
  };
}

const englishDay = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const arabicDay = new Intl.DateTimeFormat("ar", { weekday: "long", timeZone: "UTC" });

/**
 * What the model is handed: the date, what "tomorrow" means here, a calendar
 * to resolve weekday names against, the team, and the words.
 *
 * "Tomorrow" is the next day the studio works, the same reading the day planner
 * takes — said on a Thursday it is Saturday or Sunday, not a day nobody is in.
 * The preview shows the date, so the manager sees which day was understood.
 */
export function buildDictationBrief(input: {
  words: string;
  people: DictationPerson[];
  todayKey: string;
  tomorrowKey: string;
  isWorkingDay: (dayKey: string) => boolean;
}): string {
  const calendar = Array.from({ length: 15 }, (_, offset) => {
    const key = shiftDayKey(input.todayKey, offset);
    const date = dayKeyToDate(key);
    const marks = [
      key === input.todayKey ? "today" : null,
      key === input.tomorrowKey ? "tomorrow" : null,
      input.isWorkingDay(key) ? null : "the studio is closed",
    ].filter(Boolean);
    return `- ${key} — ${englishDay.format(date)} — ${arabicDay.format(date)}${marks.length ? ` (${marks.join(", ")})` : ""}`;
  });

  const team = input.people.map(
    (person) => `- id: ${person.id} — ${person.name}${person.role?.trim() ? ` (${person.role.trim()})` : ""}`
  );

  return [
    `Today is ${input.todayKey}. "Tomorrow" means ${input.tomorrowKey}, the next day the studio works.`,
    "",
    "Calendar:",
    ...calendar,
    "",
    "The team:",
    ...team,
    "",
    "What the manager said:",
    "<<<",
    input.words.trim(),
    ">>>",
  ].join("\n");
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+\n/g, "\n").trim().slice(0, max);
  return text || null;
}

function readDay(value: unknown, todayKey: string): string | null {
  if (typeof value !== "string" || !DAY_KEY.test(value)) return null;
  // A real date: 2026-02-31 passes the pattern and is nothing.
  if (dayKeyToDate(value).toISOString().slice(0, 10) !== value) return null;
  const ahead = daysBetween(todayKey, value);
  return ahead >= 0 && ahead <= HORIZON_DAYS ? value : null;
}

/**
 * One draft out of whatever was handed over — the model's answer, or the list
 * the browser sends back when the manager presses Assign. Both go through the
 * same reading, because the second is a request from the internet like any
 * other: an id in it is not evidence of anything.
 *
 * Returns null for something that cannot be a job: nobody on the team, or no
 * title. A day that cannot be read, or one in the past, falls back to today
 * rather than losing the task — the preview shows the day, so a wrong one is
 * seen and corrected, where a vanished task would not be missed until it was.
 */
export function readDraft(
  raw: unknown,
  context: { personIds: ReadonlySet<string>; todayKey: string }
): TaskDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  const employeeId = typeof (row.employeeId ?? row.person_id) === "string" ? String(row.employeeId ?? row.person_id) : "";
  if (!context.personIds.has(employeeId)) return null;

  const title = clean(row.title, 200);
  if (!title) return null;

  const start = readDay(row.startKey ?? row.start_day, context.todayKey) ?? context.todayKey;
  const end = readDay(row.endKey ?? row.end_day, context.todayKey) ?? start;
  // A range said backwards is the same range.
  const [startKey, endKey] = daysBetween(start, end) >= 0 ? [start, end] : [end, start];

  const priority = PRIORITIES.includes(row.priority as DraftPriority) ? (row.priority as DraftPriority) : "MEDIUM";

  return {
    employeeId,
    title,
    note: clean(row.note ?? row.details, 2000),
    acceptance: clean(row.acceptance ?? row.done_when, 4000),
    startKey,
    endKey,
    priority,
  };
}

/** The model's whole answer, read into drafts and the things it could not place. */
export function readDictation(
  raw: unknown,
  context: { personIds: ReadonlySet<string>; todayKey: string }
): Dictation {
  const answer = (raw && typeof raw === "object" ? raw : {}) as { tasks?: unknown; unplaced?: unknown };
  const tasks = Array.isArray(answer.tasks) ? answer.tasks : [];
  const loose = Array.isArray(answer.unplaced) ? answer.unplaced : [];

  const drafts: TaskDraft[] = [];
  const unplaced: Unplaced[] = [];

  for (const task of tasks.slice(0, MAX_DRAFTS)) {
    const draft = readDraft(task, context);
    if (draft) {
      drafts.push(draft);
      continue;
    }
    // A task that cannot be read is said, not dropped: the manager asked for
    // something and should see that it did not become a job.
    const said = clean((task as { title?: unknown } | null)?.title, 300);
    if (said) unplaced.push({ said, why: "This could not be given to anybody on the team." });
  }

  if (tasks.length > MAX_DRAFTS) {
    unplaced.push({
      said: `${tasks.length - MAX_DRAFTS} more tasks`,
      why: `Only the first ${MAX_DRAFTS} were prepared. Send the rest in a second go.`,
    });
  }

  for (const item of loose.slice(0, 40)) {
    const said = clean((item as { said?: unknown } | null)?.said, 300);
    const why = clean((item as { why?: unknown } | null)?.why, 300);
    if (said) unplaced.push({ said, why: why ?? "This could not be turned into a task." });
  }

  return { drafts, unplaced };
}

// ---------------------------------------------------------------------------
// Saying it back

/** "today", "tomorrow", or the date — tomorrow being the calendar's, since a date is being named. */
export function dayWord(dayKey: string, todayKey: string): string {
  const ahead = daysBetween(todayKey, dayKey);
  if (ahead === 0) return "today";
  if (ahead === 1) return "tomorrow";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(
    dayKeyToDate(dayKey)
  );
}

/**
 * What one person is told when a briefing gives them work: once, however many
 * tasks it held.
 *
 * Four jobs dictated in one breath are one piece of news. Four notifications
 * landing in the same second are a phone that will be muted by Thursday.
 */
export function briefingCopy(drafts: TaskDraft[], todayKey: string): { title: string; message: string } {
  if (drafts.length === 1) {
    const only = drafts[0];
    return { title: "New Task Assigned", message: `${only.title} — ${dayWord(only.startKey, todayKey)}.` };
  }

  const days = new Set(drafts.map((draft) => draft.startKey));
  const when = days.size === 1 ? ` for ${dayWord(drafts[0].startKey, todayKey)}` : "";
  const list = drafts.map((draft, index) => `${index + 1}. ${draft.title}`).join("  ");

  return {
    title: `${drafts.length} new tasks${when}`,
    message: list.length > 220 ? `${list.slice(0, 217)}…` : list,
  };
}
