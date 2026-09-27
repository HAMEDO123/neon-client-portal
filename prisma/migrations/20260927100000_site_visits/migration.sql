-- CreateEnum
CREATE TYPE "SiteVisitState" AS ENUM ('PLANNED', 'VISITED', 'MISSED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "canLogSiteVisits" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SiteVisit" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "projectId" TEXT,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "purpose" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "state" "SiteVisitState" NOT NULL DEFAULT 'PLANNED',
    "report" TEXT,
    "reportedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteVisit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SiteVisit_state_scheduledAt_idx" ON "SiteVisit"("state", "scheduledAt");

-- CreateIndex
CREATE INDEX "SiteVisit_employeeId_scheduledAt_idx" ON "SiteVisit"("employeeId", "scheduledAt");

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteVisit" ADD CONSTRAINT "SiteVisit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
