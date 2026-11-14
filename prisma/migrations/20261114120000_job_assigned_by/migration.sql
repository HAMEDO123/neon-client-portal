-- Who handed a job out, when it was not the manager. Null for everything
-- before today: it was never recorded, and is not guessed.
ALTER TABLE "AssignedTask" ADD COLUMN "assignedById" TEXT;

CREATE INDEX "AssignedTask_assignedById_createdAt_idx" ON "AssignedTask"("assignedById", "createdAt");

ALTER TABLE "AssignedTask" ADD CONSTRAINT "AssignedTask_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "Employee"("id") ON DELETE SET NULL ON UPDATE CASCADE;
