-- CreateEnum
CREATE TYPE "DeviceTokenKind" AS ENUM ('ALERT', 'VOIP');

-- AlterTable
ALTER TABLE "DeviceToken" ADD COLUMN     "kind" "DeviceTokenKind" NOT NULL DEFAULT 'ALERT';
