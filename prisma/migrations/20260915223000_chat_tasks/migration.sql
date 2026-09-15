-- AlterEnum
ALTER TYPE "ChatMessageKind" ADD VALUE 'TASK';

-- AlterTable
ALTER TABLE "AssignedTask" ADD COLUMN     "chatTaskId" TEXT;

-- CreateTable
CREATE TABLE "ChatTask" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "attachmentUrl" TEXT,
    "attachmentName" TEXT,
    "attachmentType" TEXT,
    "attachmentSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatTaskComment" (
    "id" TEXT NOT NULL,
    "chatTaskId" TEXT NOT NULL,
    "authorType" "ChatAuthorType" NOT NULL,
    "authorId" TEXT,
    "authorName" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTaskComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatTask_messageId_key" ON "ChatTask"("messageId");

-- CreateIndex
CREATE INDEX "ChatTask_channelId_createdAt_idx" ON "ChatTask"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatTask_dueAt_idx" ON "ChatTask"("dueAt");

-- CreateIndex
CREATE INDEX "ChatTaskComment_chatTaskId_createdAt_idx" ON "ChatTaskComment"("chatTaskId", "createdAt");

-- CreateIndex
CREATE INDEX "AssignedTask_chatTaskId_idx" ON "AssignedTask"("chatTaskId");

-- AddForeignKey
ALTER TABLE "AssignedTask" ADD CONSTRAINT "AssignedTask_chatTaskId_fkey" FOREIGN KEY ("chatTaskId") REFERENCES "ChatTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTask" ADD CONSTRAINT "ChatTask_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTask" ADD CONSTRAINT "ChatTask_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatTaskComment" ADD CONSTRAINT "ChatTaskComment_chatTaskId_fkey" FOREIGN KEY ("chatTaskId") REFERENCES "ChatTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;
