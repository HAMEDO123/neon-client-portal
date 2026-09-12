import { prisma } from "@/lib/db";
import { ASSISTANT_MODEL, describeAiError, getAiClient, isAiConfigured } from "@/lib/ai/client";
import { allTasks } from "@/lib/employee-tasks";
import { getPlanningNotes, getTimezone } from "@/lib/settings";
import { readinessOf } from "@/lib/task-readiness";
import { DAY_PLAN_SYSTEM, buildDayBrief, parsePlan, type PlanBlock, type PlanTask } from "@/lib/day-plan";
import { dayKeyToDate, formatDayIn, formatTimeIn } from "@/lib/time";

// "Plan tomorrow for Wael."
//
// Reads three things and writes none: what the manager wrote about how this
// person is usually worked, the studio's own rules for a day, and the real
// state of their board — then asks Claude for a timetable.
//
// The proposal is returned, never saved. Nothing on the board moves until the
// manager does it themselves, so a wrong suggestion costs a glance.

export type DayPlanResult =
  | { ok: true; person: string; dayLabel: string; blocks: PlanBlock[]; rest: string[] }
  | { ok: false; error: string };

/** Prisma's row for a task, as the brief wants it. */
function toPlanTask(
  task: Awaited<ReturnType<typeof allTasks>>[number],
  dayKey: string,
  timezone: string
): PlanTask {
  const day = dayKeyToDate(dayKey);

  return {
    id: task.id,
    name: task.task.name,
    projectName: task.project.name,
    location: task.project.location,
    readiness: readinessOf({
      state: task.state,
      blockedReason: task.blockedReason,
      blockedByName: task.blockedBy?.name ?? null,
      dependencies: task.waitsFor.map((edge) => ({
        name: edge.dependsOn.task.name,
        done: edge.dependsOn.state === "DONE",
      })),
    }),
    priority: task.priority,
    scheduledForDay: task.scheduledFor?.getTime() === day.getTime(),
    dueLabel: task.dueAt ? `${formatDayIn(timezone, task.dueAt)} ${formatTimeIn(timezone, task.dueAt)}` : null,
    estimateHours: task.estimateHours == null ? null : Number(task.estimateHours),
    deliverable: task.deliverable,
    acceptance: task.acceptance,
    lastUpdateNote: task.lastUpdateNote,
  };
}

export async function proposeDay(employeeId: string, dayKey: string): Promise<DayPlanResult> {
  if (!isAiConfigured()) {
    return { ok: false, error: "Planning needs ANTHROPIC_API_KEY set on the server." };
  }
  const client = getAiClient();
  if (!client) return { ok: false, error: "The assistant is unavailable." };

  // One after another, like every other multi-query read here.
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { name: true, role: true, playbook: true },
  });
  if (!employee) return { ok: false, error: "That employee no longer exists." };

  const timezone = await getTimezone();
  const notes = await getPlanningNotes();
  const open = await allTasks(employeeId, "open");

  // A real date always formats; the key itself is the fallback the types want.
  const dayLabel = formatDayIn(timezone, dayKeyToDate(dayKey)) ?? dayKey;
  const brief = buildDayBrief({
    person: { name: employee.name, role: employee.role, playbook: employee.playbook },
    notes,
    dayLabel,
    tasks: open.map((task) => toPlanTask(task, dayKey, timezone)),
  });

  try {
    const response = await client.messages.create({
      model: ASSISTANT_MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      system: DAY_PLAN_SYSTEM,
      messages: [
        {
          role: "user",
          content: `${brief}\n\nPlan ${employee.name}'s ${dayLabel}, minute by minute.`,
        },
      ],
    });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "The assistant declined to plan that." };
    }

    const text = response.content
      .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    if (!text) return { ok: false, error: "The assistant returned nothing." };

    const { blocks, rest } = parsePlan(text);
    return { ok: true, person: employee.name, dayLabel, blocks, rest };
  } catch (error) {
    return { ok: false, error: describeAiError(error) };
  }
}
