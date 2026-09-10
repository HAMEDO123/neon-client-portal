-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WARNING';

-- CreateTable
CREATE TABLE "EmployeeWarning" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeWarning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmployeeWarning_employeeId_createdAt_idx" ON "EmployeeWarning"("employeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "EmployeeWarning" ADD CONSTRAINT "EmployeeWarning_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
