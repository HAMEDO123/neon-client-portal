-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "awayHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "breaks" JSONB;
