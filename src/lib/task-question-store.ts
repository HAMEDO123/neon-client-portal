import { prisma } from "@/lib/db";
import { myAssignedTask } from "@/lib/assigned-tasks";
import { TEAM_CHANNEL_KEY } from "@/lib/chat-conversations";
import { taskForEmployee } from "@/lib/employee-tasks";
import { quotedTitle, splitQuestion, type AboutKind, type AboutTask, type AskWhere } from "@/lib/task-questions";

// The database side of asking about a task (lib/task-questions.ts has the
// wording). Deliberately not "use server": every export of one of those is
// callable over the network, and these trust their caller to have resolved
// who is asking.

/**
 * The task somebody may ask about — theirs, or nothing.
 *
 * Read through the same two lookups the task's own page uses, so "may I ask
 * about it" and "may I open it" cannot come apart: another person's task id
 * is not found rather than refused.
 */
export async function taskAskedAbout(employeeId: string, kind: AboutKind, id: string): Promise<AboutTask | null> {
  if (kind === "assigned") {
    const job = await myAssignedTask(employeeId, id);
    return job ? { aboutAssignedTaskId: job.id, aboutEntryId: null, aboutTitle: quotedTitle(job.title) } : null;
  }

  const task = await taskForEmployee(employeeId, id);
  if (!task) return null;
  return {
    aboutAssignedTaskId: null,
    aboutEntryId: task.id,
    // A step is the same on every project, so its name alone says too little.
    aboutTitle: quotedTitle(`${task.task.name} · ${task.project.name}`),
  };
}

export type AskedBefore = { id: string; where: AskWhere; text: string; at: Date };

/**
 * What this person has already asked about a task, newest first, and which
 * conversation each went to — so the task's page can say "you asked the
 * manager this morning" and point at where the answer is.
 */
export async function questionsAbout(employeeId: string, kind: AboutKind, id: string): Promise<AskedBefore[]> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      authorType: "EMPLOYEE",
      authorId: employeeId,
      ...(kind === "assigned" ? { aboutAssignedTaskId: id } : { aboutEntryId: id }),
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, body: true, aboutTitle: true, createdAt: true, channel: { select: { key: true } } },
  });

  return rows.map((row) => ({
    id: row.id,
    where: row.channel.key === TEAM_CHANNEL_KEY ? ("team" as const) : ("manager" as const),
    text: splitQuestion(row.body, row.aboutTitle).text ?? "",
    at: row.createdAt,
  }));
}
