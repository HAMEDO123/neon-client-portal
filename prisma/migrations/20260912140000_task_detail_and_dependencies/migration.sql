-- AlterTable
ALTER TABLE "ProjectTaskEntry" ADD COLUMN     "acceptance" TEXT,
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "deliverable" TEXT,
ADD COLUMN     "estimateHours" DOUBLE PRECISION,
ADD COLUMN     "lastUpdateAt" TIMESTAMP(3),
ADD COLUMN     "lastUpdateNote" TEXT,
ADD COLUMN     "nextStep" TEXT;

-- AlterTable
ALTER TABLE "AssignedTask" ADD COLUMN     "acceptance" TEXT,
ADD COLUMN     "blockedById" TEXT,
ADD COLUMN     "blockedReason" TEXT,
ADD COLUMN     "deliverable" TEXT,
ADD COLUMN     "estimateHours" DOUBLE PRECISION,
ADD COLUMN     "lastUpdateAt" TIMESTAMP(3),
ADD COLUMN     "lastUpdateNote" TEXT,
ADD COLUMN     "nextStep" TEXT;

-- CreateTable
CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "dependsOnEntryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskDependency_dependsOnEntryId_idx" ON "TaskDependency"("dependsOnEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "TaskDependency_entryId_dependsOnEntryId_key" ON "TaskDependency"("entryId", "dependsOnEntryId");

-- CreateIndex
CREATE INDEX "ProjectTaskEntry_blockedById_idx" ON "ProjectTaskEntry"("blockedById");

-- AddForeignKey
ALTER TABLE "ProjectTaskEntry" ADD CONSTRAINT "ProjectTaskEntry_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignedTask" ADD CONSTRAINT "AssignedTask_blockedById_fkey" FOREIGN KEY ("blockedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ProjectTaskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnEntryId_fkey" FOREIGN KEY ("dependsOnEntryId") REFERENCES "ProjectTaskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
