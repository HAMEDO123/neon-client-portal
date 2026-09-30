-- CreateEnum
CREATE TYPE "DevicePushKind" AS ENUM ('ALERT', 'VOIP');

-- AlterTable
ALTER TABLE "DeviceToken" ADD COLUMN     "kind" "DevicePushKind" NOT NULL DEFAULT 'ALERT';

-- CreateIndex
CREATE INDEX "DeviceToken_employeeId_kind_active_idx" ON "DeviceToken"("employeeId", "kind", "active");
