-- Clocking in and out from the app, with where it was done. Off for everybody
-- but whoever the manager turns it on for.
ALTER TABLE "Employee" ADD COLUMN "appClockIn" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AppPunch" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppPunch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppPunch_employeeId_at_idx" ON "AppPunch"("employeeId", "at");
CREATE INDEX "AppPunch_at_idx" ON "AppPunch"("at");

ALTER TABLE "AppPunch" ADD CONSTRAINT "AppPunch_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
