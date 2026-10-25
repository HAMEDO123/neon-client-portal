-- The manager's walkie-talkie (lib/walkie.ts): a Push to Talk token kind, and
-- a row for each thing said.
ALTER TYPE "DeviceTokenKind" ADD VALUE 'PTT';

CREATE TABLE "WalkieMessage" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "audioUrl" TEXT NOT NULL,
    "seconds" INTEGER,
    "phones" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalkieMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "WalkieMessage_employeeId_createdAt_idx" ON "WalkieMessage"("employeeId", "createdAt");

ALTER TABLE "WalkieMessage" ADD CONSTRAINT "WalkieMessage_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
