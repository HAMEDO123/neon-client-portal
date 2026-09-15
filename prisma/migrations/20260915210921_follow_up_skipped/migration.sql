-- AlterTable
ALTER TABLE "ScheduledFollowUp" ADD COLUMN     "skippedAt" TIMESTAMP(3),
ADD COLUMN     "skippedBecause" TEXT;
