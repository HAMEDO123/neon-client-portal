-- CreateTable
CREATE TABLE "TaskStateChange" (
    "id" TEXT NOT NULL,
    "entryId" TEXT,
    "assignedTaskId" TEXT,
    "fromState" "TaskState" NOT NULL,
    "toState" "TaskState" NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorEmployeeId" TEXT,
    "reason" TEXT,
    "automatic" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskStateChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskStateChange_entryId_createdAt_idx" ON "TaskStateChange"("entryId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskStateChange_assignedTaskId_createdAt_idx" ON "TaskStateChange"("assignedTaskId", "createdAt");

-- AddForeignKey
ALTER TABLE "TaskStateChange" ADD CONSTRAINT "TaskStateChange_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "ProjectTaskEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskStateChange" ADD CONSTRAINT "TaskStateChange_assignedTaskId_fkey" FOREIGN KEY ("assignedTaskId") REFERENCES "AssignedTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
