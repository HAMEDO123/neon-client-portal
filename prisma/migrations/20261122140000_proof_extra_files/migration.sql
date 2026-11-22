-- AlterTable
ALTER TABLE "TaskSubmission" ADD COLUMN     "extraUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
