-- AlterTable
ALTER TABLE "TaskSubmission" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "outcome" TEXT;

-- CreateTable
CREATE TABLE "SubmissionCheck" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "required" TEXT NOT NULL,
    "evidence" TEXT,
    "verdict" TEXT NOT NULL,
    "gap" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionCheck_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubmissionCheck_submissionId_createdAt_idx" ON "SubmissionCheck"("submissionId", "createdAt");

-- AddForeignKey
ALTER TABLE "SubmissionCheck" ADD CONSTRAINT "SubmissionCheck_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "TaskSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
