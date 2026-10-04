-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SITE_VISIT';

-- AlterTable
ALTER TABLE "AssignedTask" ADD COLUMN "siteVisitId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AssignedTask_siteVisitId_key" ON "AssignedTask"("siteVisitId");

-- AddForeignKey
ALTER TABLE "AssignedTask" ADD CONSTRAINT "AssignedTask_siteVisitId_fkey" FOREIGN KEY ("siteVisitId") REFERENCES "SiteVisit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
