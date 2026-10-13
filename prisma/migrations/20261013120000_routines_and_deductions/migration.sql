-- AlterTable
ALTER TABLE "AssignedTask" ADD COLUMN     "routineId" TEXT;

-- CreateTable
CREATE TABLE "RoutineTask" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "acceptance" TEXT,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoutineTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Deduction" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "periodKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "hours" DOUBLE PRECISION,
    "amount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "assignedTaskId" TEXT,
    "dedupeKey" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Deduction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RoutineTask_employeeId_active_idx" ON "RoutineTask"("employeeId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Deduction_dedupeKey_key" ON "Deduction"("dedupeKey");

-- CreateIndex
CREATE INDEX "Deduction_periodKey_idx" ON "Deduction"("periodKey");

-- CreateIndex
CREATE INDEX "Deduction_employeeId_periodKey_idx" ON "Deduction"("employeeId", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "AssignedTask_routineId_startDay_key" ON "AssignedTask"("routineId", "startDay");

-- AddForeignKey
ALTER TABLE "RoutineTask" ADD CONSTRAINT "RoutineTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deduction" ADD CONSTRAINT "Deduction_assignedTaskId_fkey" FOREIGN KEY ("assignedTaskId") REFERENCES "AssignedTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignedTask" ADD CONSTRAINT "AssignedTask_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "RoutineTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;
