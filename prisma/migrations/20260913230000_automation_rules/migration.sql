-- CreateTable
CREATE TABLE "AutomationRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "atLeast" INTEGER NOT NULL DEFAULT 1,
    "action" TEXT NOT NULL DEFAULT 'ask',
    "recipient" TEXT NOT NULL DEFAULT 'the-person',
    "graceMinutes" INTEGER NOT NULL DEFAULT 0,
    "cooldownMinutes" INTEGER NOT NULL DEFAULT 0,
    "escalateAfterMinutes" INTEGER,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationState" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "since" TIMESTAMP(3),
    "lastActedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationState_employeeId_day_idx" ON "AutomationState"("employeeId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationState_ruleId_employeeId_day_key" ON "AutomationState"("ruleId", "employeeId", "day");

-- AddForeignKey
ALTER TABLE "AutomationState" ADD CONSTRAINT "AutomationState_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "AutomationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationState" ADD CONSTRAINT "AutomationState_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
