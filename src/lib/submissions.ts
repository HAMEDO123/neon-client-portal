import { prisma } from "@/lib/db";

// Reading the evidence queue. Writes live in
// src/lib/actions/submission-actions.ts — a "use server" file exports actions
// only, so a query here never becomes something a browser can call.

export function pendingSubmissions(limit = 50) {
  return prisma.taskSubmission.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: limit,
    include: {
      employee: { select: { id: true, name: true, color: true } },
      // Evidence is for a cell on the board or for a job handed out by hand —
      // one of the two, never both.
      entry: {
        select: {
          id: true,
          task: { select: { name: true } },
          project: { select: { name: true } },
        },
      },
      assignedTask: { select: { id: true, title: true } },
    },
  });
}

export type PendingSubmission = Awaited<ReturnType<typeof pendingSubmissions>>[number];

export function countPendingSubmissions() {
  return prisma.taskSubmission.count({ where: { status: "PENDING" } });
}

/** The evidence sent for one board cell, newest first. */
export function submissionsForEntry(entryId: string) {
  return prisma.taskSubmission.findMany({
    where: { entryId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}

/** The evidence sent for one hand-assigned job, newest first. */
export function submissionsForAssignedTask(assignedTaskId: string) {
  return prisma.taskSubmission.findMany({
    where: { assignedTaskId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}
