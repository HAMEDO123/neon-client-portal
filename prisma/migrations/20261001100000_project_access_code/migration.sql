-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "accessCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Project_accessCode_key" ON "Project"("accessCode");
