-- CreateTable
CREATE TABLE "StaffLocation" (
    "employeeId" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "fixedAt" TIMESTAMP(3),
    "permission" TEXT NOT NULL DEFAULT 'unknown',
    "precise" BOOLEAN NOT NULL DEFAULT true,
    "pingedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffLocation_pkey" PRIMARY KEY ("employeeId")
);

-- AddForeignKey
ALTER TABLE "StaffLocation" ADD CONSTRAINT "StaffLocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;
