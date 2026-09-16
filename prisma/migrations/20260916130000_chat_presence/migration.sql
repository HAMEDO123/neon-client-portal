-- CreateTable
CREATE TABLE "ChatPresence" (
    "id" TEXT NOT NULL,
    "memberKey" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "typingChannelId" TEXT,
    "typingAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatPresence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatPresence_memberKey_key" ON "ChatPresence"("memberKey");

-- CreateIndex
CREATE INDEX "ChatPresence_lastSeenAt_idx" ON "ChatPresence"("lastSeenAt");
