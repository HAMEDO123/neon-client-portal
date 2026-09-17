-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "deviceUserId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Employee_deviceUserId_key" ON "Employee"("deviceUserId");
