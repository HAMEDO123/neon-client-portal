-- CreateTable
CREATE TABLE "ScheduledFollowUp" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "blockIndex" INTEGER,
    "entryId" TEXT,
    "jobId" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "askedAt" TIMESTAMP(3),
    "answeredAt" TIMESTAMP(3),
    "answer" TEXT,
    "answerNote" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduledFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ScheduledFollowUp_dedupeKey_key" ON "ScheduledFollowUp"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScheduledFollowUp_dueAt_askedAt_idx" ON "ScheduledFollowUp"("dueAt", "askedAt");

-- CreateIndex
CREATE INDEX "ScheduledFollowUp_employeeId_day_idx" ON "ScheduledFollowUp"("employeeId", "day");

-- AddForeignKey
ALTER TABLE "ScheduledFollowUp" ADD CONSTRAINT "ScheduledFollowUp_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
