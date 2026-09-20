-- APNs as a second push transport, beside web push.
--
-- Purely additive: a new table, one nullable column on NotificationDelivery,
-- and one new value on the DeliveryChannel enum. Nothing existing is dropped,
-- narrowed or made NOT NULL, so applying this to the live database cannot lose
-- anything and the running version keeps working until it is replaced.
--
-- `ALTER TYPE ... ADD VALUE` inside a transaction is fine on PostgreSQL 12+
-- (the studio runs 17) as long as the new value is not USED in the same
-- transaction. Nothing below writes 'APNS', so this applies cleanly. If a
-- later migration ever needs to both add an enum value and use it, that has to
-- be two migrations.

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS');

-- AlterEnum
ALTER TYPE "DeliveryChannel" ADD VALUE 'APNS';

-- AlterTable
ALTER TABLE "NotificationDelivery" ADD COLUMN     "deviceTokenId" TEXT;

-- CreateTable
CREATE TABLE "DeviceToken" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL DEFAULT 'IOS',
    "bundleId" TEXT NOT NULL,
    "sandbox" BOOLEAN NOT NULL DEFAULT false,
    "deviceName" TEXT,
    "appVersion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "DeviceToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceToken_token_key" ON "DeviceToken"("token");

-- CreateIndex
CREATE INDEX "DeviceToken_employeeId_active_idx" ON "DeviceToken"("employeeId", "active");

-- AddForeignKey
ALTER TABLE "DeviceToken" ADD CONSTRAINT "DeviceToken_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationDelivery" ADD CONSTRAINT "NotificationDelivery_deviceTokenId_fkey" FOREIGN KEY ("deviceTokenId") REFERENCES "DeviceToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;
