-- CreateTable
CREATE TABLE "SupplyRequestLine" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" TEXT,
    "estimatedCost" DOUBLE PRECISION,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupplyRequestLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SupplyRequestLine_requestId_position_idx" ON "SupplyRequestLine"("requestId", "position");

-- AddForeignKey
ALTER TABLE "SupplyRequestLine" ADD CONSTRAINT "SupplyRequestLine_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "SupplyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
