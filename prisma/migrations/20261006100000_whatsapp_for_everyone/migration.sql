-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'WHATSAPP_MESSAGE';

-- AlterTable
ALTER TABLE "Employee" ALTER COLUMN "canReadWhatsApp" SET DEFAULT true;

-- The studio decided the whole team reads and answers the company's WhatsApp.
-- The manager's own row is left alone: the manager is let in by the admin
-- session, never by this column.
UPDATE "Employee" SET "canReadWhatsApp" = true WHERE "accessRole" = 'EMPLOYEE';
