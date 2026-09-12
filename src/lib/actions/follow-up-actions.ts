"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireEmployee } from "@/lib/employee-session";
import { taskForEmployee } from "@/lib/employee-tasks";
import { recordAnswer } from "@/lib/follow-up-queue";
import { notifyAdmin } from "@/lib/admin-notifications";

// What an employee says back when the day asks them something.
//
// The same two rules as every other employee action: the person comes from the
// signed session and never from an argument, and every read is scoped by
// ownership, so another employee's question simply matches no rows.
//
// What this deliberately does not do: write the manager's fields. "Blocked" is
// recorded as the employee's answer and the manager is told — it does not set
// `blockedReason`, which is the manager's own record of why something cannot
// move. An answer is evidence for a decision, not the decision.

/** The answers a question can be given. */
const ANSWERS = ["started", "need-info", "blocked", "more-time", "done", "partly", "not-started"] as const;
export type FollowUpAnswer = (typeof ANSWERS)[number];

/** The ones the manager should hear about at once. */
const TELL_THE_MANAGER: FollowUpAnswer[] = ["blocked", "need-info", "more-time"];

const SAID: Record<FollowUpAnswer, string> = {
  started: "started",
  "need-info": "needs information",
  blocked: "is blocked",
  "more-time": "needs more time",
  done: "finished",
  partly: "partly finished",
  "not-started": "has not started",
};

export async function answerFollowUp(
  followUpId: string,
  answer: string,
  note?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const employee = await requireEmployee();

  if (!ANSWERS.includes(answer as FollowUpAnswer)) {
    return { ok: false, error: "That is not an answer to this." };
  }
  const said = answer as FollowUpAnswer;

  // Scoped by employee: somebody else's question is not found rather than refused.
  const followUp = await prisma.scheduledFollowUp.findFirst({
    where: { id: followUpId, employeeId: employee.id },
    select: { id: true, entryId: true, jobId: true, kind: true, answeredAt: true },
  });
  if (!followUp) return { ok: false, error: "That question is no longer open." };

  await recordAnswer(followUp.id, said, note);

  // "Started" is a status change the employee is allowed to make, so make it —
  // but only from the states they may move, and never over the manager's.
  if (said === "started" && followUp.entryId) {
    const task = await taskForEmployee(employee.id, followUp.entryId);
    if (task && task.state === "TODO") {
      await prisma.projectTaskEntry.update({
        where: { id: task.id },
        data: { state: "IN_PROGRESS", startedAt: task.startedAt ?? new Date(), completedAt: null },
      });
    }
  }

  // Anything the manager would want to act on today, told once: the key is the
  // question and the answer, never the clock.
  if (TELL_THE_MANAGER.includes(said)) {
    await notifyAdmin({
      type: "TASK_STATUS_CHANGED",
      title: `${employee.name} ${SAID[said]}`,
      message: note?.trim()
        ? `${employee.name} ${SAID[said]}: ${note.trim().slice(0, 300)}`
        : `${employee.name} ${SAID[said]} on today's plan.`,
      url: "/admin/tasks",
      dedupeKey: `FOLLOW_UP_ANSWER:${followUp.id}:${said}`,
      entryId: followUp.entryId,
      employeeId: employee.id,
    }).catch(() => null);
  }

  revalidatePath("/employee");
  revalidatePath("/employee/tasks");
  if (followUp.entryId) revalidatePath(`/employee/tasks/${followUp.entryId}`);
  if (followUp.jobId) revalidatePath(`/employee/assigned/${followUp.jobId}`);
  revalidatePath("/admin/tasks");

  return { ok: true };
}
