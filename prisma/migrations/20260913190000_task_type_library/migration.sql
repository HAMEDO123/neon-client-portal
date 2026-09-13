-- AlterTable
ALTER TABLE "ProcessTask" ADD COLUMN     "acceptance" TEXT,
ADD COLUMN     "autoAccept" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "checklist" TEXT,
ADD COLUMN     "deliverable" TEXT,
ADD COLUMN     "estimateHours" DOUBLE PRECISION,
ADD COLUMN     "evidence" TEXT,
ADD COLUMN     "reviewerId" TEXT;

-- AddForeignKey
ALTER TABLE "ProcessTask" ADD CONSTRAINT "ProcessTask_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
