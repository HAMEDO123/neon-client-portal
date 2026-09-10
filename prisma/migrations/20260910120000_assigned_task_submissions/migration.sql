-- AlterTable
ALTER TABLE "TaskSubmission" ADD COLUMN     "assignedTaskId" TEXT,
ALTER COLUMN "entryId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "TaskSubmission_assignedTaskId_createdAt_idx" ON "TaskSubmission"("assignedTaskId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskSubmission" ADD CONSTRAINT "TaskSubmission_assignedTaskId_fkey" FOREIGN KEY ("assignedTaskId") REFERENCES "AssignedTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
