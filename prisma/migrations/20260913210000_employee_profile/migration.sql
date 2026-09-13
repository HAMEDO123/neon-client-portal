-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "dailyCapacityMinutes" INTEGER,
ADD COLUMN     "examples" TEXT,
ADD COLUMN     "reviewerId" TEXT,
ADD COLUMN     "skills" TEXT;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
