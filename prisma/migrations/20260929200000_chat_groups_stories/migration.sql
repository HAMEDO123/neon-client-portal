-- CreateTable
CREATE TABLE "ChatGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "photoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatPref" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "readerKey" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatStory" (
    "id" TEXT NOT NULL,
    "authorKey" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorId" TEXT,
    "mediaUrl" TEXT NOT NULL,
    "mediaType" TEXT NOT NULL,
    "caption" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatStory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatStoryView" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "viewerKey" TEXT NOT NULL,
    "viewerName" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatStoryView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatGroupMember_employeeId_idx" ON "ChatGroupMember"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatGroupMember_groupId_employeeId_key" ON "ChatGroupMember"("groupId", "employeeId");

-- CreateIndex
CREATE INDEX "ChatPref_readerKey_idx" ON "ChatPref"("readerKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChatPref_channelId_readerKey_key" ON "ChatPref"("channelId", "readerKey");

-- CreateIndex
CREATE INDEX "ChatStory_expiresAt_idx" ON "ChatStory"("expiresAt");

-- CreateIndex
CREATE INDEX "ChatStory_authorKey_createdAt_idx" ON "ChatStory"("authorKey", "createdAt");

-- CreateIndex
CREATE INDEX "ChatStoryView_viewerKey_idx" ON "ChatStoryView"("viewerKey");

-- CreateIndex
CREATE UNIQUE INDEX "ChatStoryView_storyId_viewerKey_key" ON "ChatStoryView"("storyId", "viewerKey");

-- AddForeignKey
ALTER TABLE "ChatGroupMember" ADD CONSTRAINT "ChatGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ChatGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatGroupMember" ADD CONSTRAINT "ChatGroupMember_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatPref" ADD CONSTRAINT "ChatPref_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatStory" ADD CONSTRAINT "ChatStory_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatStoryView" ADD CONSTRAINT "ChatStoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "ChatStory"("id") ON DELETE CASCADE ON UPDATE CASCADE;
