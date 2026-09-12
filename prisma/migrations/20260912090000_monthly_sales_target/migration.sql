-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "monthlySalesTarget" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "soldById" TEXT,
ADD COLUMN     "soldOn" DATE;

-- CreateIndex
CREATE INDEX "Project_soldById_soldOn_idx" ON "Project"("soldById", "soldOn");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_soldById_fkey" FOREIGN KEY ("soldById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
