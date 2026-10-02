-- AlterEnum
ALTER TYPE "AdminNotificationType" ADD VALUE 'LOCATION';

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'LOCATION_REMINDER';

-- CreateTable
CREATE TABLE "LocationDay" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "fixes" INTEGER NOT NULL DEFAULT 0,
    "firstAt" TIMESTAMP(3),
    "lastAt" TIMESTAMP(3),
    "warnedAt" TIMESTAMP(3),
    "warned2At" TIMESTAMP(3),
    "finedAt" TIMESTAMP(3),
    "forgivenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationDay_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LocationDay_day_idx" ON "LocationDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "LocationDay_employeeId_day_key" ON "LocationDay"("employeeId", "day");

-- AddForeignKey
ALTER TABLE "LocationDay" ADD CONSTRAINT "LocationDay_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
