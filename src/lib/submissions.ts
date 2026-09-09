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
      entry: {
        select: {
          id: true,
          task: { select: { name: true } },
          project: { select: { name: true } },
        },
      },
    },
  });
}

export type PendingSubmission = Awaited<ReturnType<typeof pendingSubmissions>>[number];

export function countPendingSubmissions() {
  return prisma.taskSubmission.count({ where: { status: "PENDING" } });
}

/** The evidence sent for one task, newest first. */
export function submissionsForEntry(entryId: string) {
  return prisma.taskSubmission.findMany({
    where: { entryId },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
}
