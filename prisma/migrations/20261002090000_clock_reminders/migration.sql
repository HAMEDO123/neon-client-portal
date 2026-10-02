-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'ATTENDANCE_REMINDER';

-- AlterEnum
ALTER TYPE "AdminNotificationType" ADD VALUE 'ATTENDANCE';

-- CreateTable
CREATE TABLE "ClockReminder" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "kind" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "notificationId" TEXT,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClockReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClockReminder_employeeId_day_kind_key" ON "ClockReminder"("employeeId", "day", "kind");

-- AddForeignKey
ALTER TABLE "ClockReminder" ADD CONSTRAINT "ClockReminder_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
