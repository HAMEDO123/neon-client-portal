-- AlterTable
ALTER TABLE "ProcessTask" DROP COLUMN "durationDays",
ADD COLUMN     "sectionId" TEXT;

-- CreateTable
CREATE TABLE "ProcessSection" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "color" TEXT NOT NULL DEFAULT 'cyan',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessSection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StagePeriod" (
    "id" TEXT NOT NULL,
    "fromTaskId" TEXT NOT NULL,
    "toTaskId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StagePeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectSectionAssignment" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "employeeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectSectionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssignedTask" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "startDay" DATE NOT NULL,
    "endDay" DATE NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssignedTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StagePeriod_fromTaskId_toTaskId_key" ON "StagePeriod"("fromTaskId", "toTaskId");

-- CreateIndex
CREATE INDEX "ProjectSectionAssignment_employeeId_idx" ON "ProjectSectionAssignment"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectSectionAssignment_projectId_sectionId_key" ON "ProjectSectionAssignment"("projectId", "sectionId");

-- CreateIndex
CREATE INDEX "AssignedTask_employeeId_startDay_idx" ON "AssignedTask"("employeeId", "startDay");

-- CreateIndex
CREATE INDEX "AssignedTask_startDay_endDay_idx" ON "AssignedTask"("startDay", "endDay");

-- AddForeignKey
ALTER TABLE "ProcessTask" ADD CONSTRAINT "ProcessTask_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ProcessSection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagePeriod" ADD CONSTRAINT "StagePeriod_fromTaskId_fkey" FOREIGN KEY ("fromTaskId") REFERENCES "ProcessTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StagePeriod" ADD CONSTRAINT "StagePeriod_toTaskId_fkey" FOREIGN KEY ("toTaskId") REFERENCES "ProcessTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSectionAssignment" ADD CONSTRAINT "ProjectSectionAssignment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSectionAssignment" ADD CONSTRAINT "ProjectSectionAssignment_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ProcessSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectSectionAssignment" ADD CONSTRAINT "ProjectSectionAssignment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssignedTask" ADD CONSTRAINT "AssignedTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
