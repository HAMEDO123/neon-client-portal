-- CreateEnum
CREATE TYPE "PayBasis" AS ENUM ('MONTHLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "SupplyRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'PURCHASED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('PENDING', 'ANALYZED', 'FAILED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "payBasis" "PayBasis" NOT NULL DEFAULT 'MONTHLY',
ADD COLUMN     "salaryAmount" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "SupplyRequest" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" TEXT,
    "note" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "status" "SupplyRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseReceipt" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "imageUrl" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'PENDING',
    "vendor" TEXT,
    "receiptDate" TIMESTAMP(3),
    "rawAmount" DOUBLE PRECISION,
    "countedAmount" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'JOD',
    "summary" TEXT,
    "aiNotes" TEXT,
    "periodMonth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExpenseReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "delayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyRequest_status_createdAt_idx" ON "SupplyRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "SupplyRequest_employeeId_createdAt_idx" ON "SupplyRequest"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "ExpenseReceipt_employeeId_periodMonth_idx" ON "ExpenseReceipt"("employeeId", "periodMonth");

-- CreateIndex
CREATE INDEX "ExpenseReceipt_periodMonth_status_idx" ON "ExpenseReceipt"("periodMonth", "status");

-- CreateIndex
CREATE INDEX "AttendanceRecord_day_idx" ON "AttendanceRecord"("day");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_employeeId_day_key" ON "AttendanceRecord"("employeeId", "day");

-- AddForeignKey
ALTER TABLE "SupplyRequest" ADD CONSTRAINT "SupplyRequest_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseReceipt" ADD CONSTRAINT "ExpenseReceipt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
