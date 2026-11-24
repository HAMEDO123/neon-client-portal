-- Every try at clocking in from the app, kept or refused, with where it was made.
CREATE TABLE "AppClockAttempt" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "fixedAt" TIMESTAMP(3),
    "distanceMetres" DOUBLE PRECISION,

    CONSTRAINT "AppClockAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AppClockAttempt_employeeId_at_idx" ON "AppClockAttempt"("employeeId", "at");
CREATE INDEX "AppClockAttempt_at_idx" ON "AppClockAttempt"("at");

ALTER TABLE "AppClockAttempt" ADD CONSTRAINT "AppClockAttempt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
