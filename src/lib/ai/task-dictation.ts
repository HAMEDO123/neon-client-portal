import { prisma } from "@/lib/db";
import { ASSISTANT_MODEL, describeAiError, getAiClient, isAiConfigured } from "@/lib/ai/client";
import { getTimezone, getWorkHours } from "@/lib/settings";
import { todayKey } from "@/lib/time";
import { isWorkingDay, nextWorkingDay } from "@/lib/work-hours";
import {
  DICTATION_SYSTEM,
  MAX_WORDS,
  buildDictationBrief,
  dictationSchema,
  readDictation,
  type Dictation,
} from "@/lib/task-dictation";

// "Wael today: one, two, three. Sally tomorrow: …"
//
// Reads what the manager said and hands back drafts — who, what, which day —
// and whatever it could not place. It creates nothing: the drafts go to a
// screen the manager reads before anything is sent (lib/task-dictation.ts says
// why). Everything it knows about the team and the calendar is read here, at
// the moment of asking, never taken from the browser.
//
// The answer is constrained to a schema (`output_config.format`), with the
// team's ids as an enum, so there is no parsing of prose and no way to answer
// with a person who does not exist.

export type DictationResult =
  | ({ ok: true; todayKey: string; tomorrowKey: string } & Dictation)
  | { ok: false; error: string };

export async function draftTasksFromWords(words: string): Promise<DictationResult> {
  const said = words.trim();
  if (!said) return { ok: false, error: "Say or type who does what first." };
  if (said.length > MAX_WORDS) {
    // Not cut short and read anyway: the end of a briefing is as much a part
    // of it as the start, and half a list handed out looks like the whole one.
    return { ok: false, error: "That is too much for one go. Send it in two parts." };
  }

  if (!isAiConfigured()) {
    return { ok: false, error: "The assistant needs ANTHROPIC_API_KEY set on the server." };
  }
  const client = getAiClient();
  if (!client) return { ok: false, error: "The assistant is unavailable." };

  // Staff only, as everywhere work is handed out: the manager's own row exists
  // for the attendance device and is not somebody a job can be given to.
  const people = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE" },
    orderBy: [{ order: "asc" }, { name: "asc" }],
    select: { id: true, name: true, role: true },
  });
  if (people.length === 0) return { ok: false, error: "There is nobody on the team to give work to yet." };

  const timezone = await getTimezone();
  const hours = await getWorkHours();
  const today = todayKey(timezone);
  const tomorrow = nextWorkingDay(hours, today);

  const brief = buildDictationBrief({
    words: said,
    people,
    todayKey: today,
    tomorrowKey: tomorrow,
    isWorkingDay: (dayKey) => isWorkingDay(hours, dayKey),
  });

  try {
    const response = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: dictationSchema(people.map((person) => person.id)) },
      },
      system: DICTATION_SYSTEM,
      messages: [{ role: "user", content: brief }],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The assistant would not read that. Try saying it another way." };
    }
    if (response.stop_reason === "max_tokens") {
      // A list cut off part-way would look complete on the screen.
      return { ok: false, error: "That was too long to finish reading. Send it in two parts." };
    }

    const text = response.content.find((block) => block.type === "text");
    if (!text || text.type !== "text") return { ok: false, error: "The assistant gave no answer. Try again." };

    let answer: unknown;
    try {
      answer = JSON.parse(text.text);
    } catch {
      return { ok: false, error: "The assistant's answer could not be read. Try again." };
    }

    const dictation = readDictation(answer, { personIds: new Set(people.map((person) => person.id)), todayKey: today });
    return { ok: true, todayKey: today, tomorrowKey: tomorrow, ...dictation };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}
