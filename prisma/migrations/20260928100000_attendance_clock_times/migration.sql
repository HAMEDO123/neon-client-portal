-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "earlyHours" DOUBLE PRECISION NOT NULL DEFAULT 0;
