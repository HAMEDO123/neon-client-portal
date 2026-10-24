-- AlterTable
ALTER TABLE "AttendanceRecord" ADD COLUMN     "shortHours" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Every day already recorded keeps exactly the charge it had: lateness,
-- leaving early and time stepped out, added the way payroll added them.
-- Without this line every settled payslip would recompute to nothing.
UPDATE "AttendanceRecord" SET "shortHours" = "delayHours" + "earlyHours" + "awayHours";
