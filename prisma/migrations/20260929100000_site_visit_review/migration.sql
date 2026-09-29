-- AlterEnum
ALTER TYPE "SiteVisitState" ADD VALUE 'REPORTED';

-- AlterTable
ALTER TABLE "SiteVisit" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "clientPhone" TEXT,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewSentAt" TIMESTAMP(3);
