-- AlterTable
ALTER TABLE "ChatMessage" ADD COLUMN     "aboutAssignedTaskId" TEXT,
ADD COLUMN     "aboutEntryId" TEXT,
ADD COLUMN     "aboutTitle" TEXT;

-- CreateIndex
CREATE INDEX "ChatMessage_aboutAssignedTaskId_idx" ON "ChatMessage"("aboutAssignedTaskId");

-- CreateIndex
CREATE INDEX "ChatMessage_aboutEntryId_idx" ON "ChatMessage"("aboutEntryId");

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_aboutAssignedTaskId_fkey" FOREIGN KEY ("aboutAssignedTaskId") REFERENCES "AssignedTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_aboutEntryId_fkey" FOREIGN KEY ("aboutEntryId") REFERENCES "ProjectTaskEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
