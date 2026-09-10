import { prisma } from "@/lib/db";

// One number that changes whenever anything in the platform does.
//
// Live sync here is deliberately not an in-memory event bus: the app runs
// behind a proxy that can restart it and may run more than one copy of it, and
// a bus in process memory tells a second copy nothing. The database is the one
// thing every copy shares, so "has anything changed" is asked of it directly —
// the newest timestamp and the row count of each table people actually watch,
// concatenated into a signature. Cheap (indexed aggregates, no scan of any
// row body), correct across restarts, and it notices deletions as well as
// writes.
//
// Clients hold /api/live open and re-render when the signature moves.

export async function liveSignature(): Promise<string> {
  const rows = await prisma.$queryRaw<{ sig: string }[]>`
    SELECT concat_ws(
      '.',
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0)::bigint FROM "ProjectTaskEntry"),
      (SELECT COUNT(*) FROM "ProjectTaskEntry"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("createdAt")) * 1000), 0)::bigint FROM "TaskSubmission"),
      (SELECT COUNT(*) FROM "TaskSubmission" WHERE "status" = 'PENDING'),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("createdAt")) * 1000), 0)::bigint FROM "AdminNotification"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("createdAt")) * 1000), 0)::bigint FROM "Notification"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("createdAt")) * 1000), 0)::bigint FROM "ChatMessage"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0)::bigint FROM "SupplyRequest"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0)::bigint FROM "ExpenseReceipt"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0)::bigint FROM "Employee"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("createdAt")) * 1000), 0)::bigint FROM "ProcessTask"),
      (SELECT COUNT(*) FROM "ProcessTask"),
      -- The week table's jobs, and who holds which section of which project.
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0)::bigint FROM "AssignedTask"),
      (SELECT COUNT(*) FROM "AssignedTask"),
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("updatedAt")) * 1000), 0)::bigint FROM "ProjectSectionAssignment"),
      (SELECT COUNT(*) FROM "ProjectSectionAssignment"),
      -- Warnings, pinned to the top of the employee's home screen.
      (SELECT COALESCE((EXTRACT(EPOCH FROM MAX("createdAt")) * 1000), 0)::bigint FROM "EmployeeWarning"),
      (SELECT COUNT(*) FROM "EmployeeWarning")
    ) AS sig
  `;

  return rows[0]?.sig ?? "";
}
