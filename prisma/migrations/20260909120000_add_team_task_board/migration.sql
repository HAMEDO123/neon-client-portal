-- CreateEnum
CREATE TYPE "TaskState" AS ENUM ('TODO', 'DONE', 'TOMORROW');

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "color" TEXT NOT NULL DEFAULT 'cyan',
    "order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessTask" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "employeeId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectTaskEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "state" "TaskState" NOT NULL DEFAULT 'TODO',
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectTaskEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectTaskEntry_taskId_idx" ON "ProjectTaskEntry"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectTaskEntry_projectId_taskId_key" ON "ProjectTaskEntry"("projectId", "taskId");

-- AddForeignKey
ALTER TABLE "ProcessTask" ADD CONSTRAINT "ProcessTask_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskEntry" ADD CONSTRAINT "ProjectTaskEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectTaskEntry" ADD CONSTRAINT "ProjectTaskEntry_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "ProcessTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
