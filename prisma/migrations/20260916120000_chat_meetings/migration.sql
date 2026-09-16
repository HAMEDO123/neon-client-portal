-- CreateEnum
CREATE TYPE "MeetingMode" AS ENUM ('ONLINE', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "MeetingRsvp" AS ENUM ('INVITED', 'ACCEPTED', 'DECLINED');

-- AlterEnum
ALTER TYPE "ChatMessageKind" ADD VALUE 'MEETING';

-- CreateTable
CREATE TABLE "ChatMeeting" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "agenda" TEXT,
    "mode" "MeetingMode" NOT NULL DEFAULT 'ONLINE',
    "place" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 30,
    "remindMinutes" INTEGER NOT NULL DEFAULT 10,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMeeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMeetingAttendee" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "memberKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "rsvp" "MeetingRsvp" NOT NULL DEFAULT 'INVITED',
    "respondedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMeetingAttendee_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChatMeeting_messageId_key" ON "ChatMeeting"("messageId");

-- CreateIndex
CREATE INDEX "ChatMeeting_channelId_createdAt_idx" ON "ChatMeeting"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMeeting_startsAt_idx" ON "ChatMeeting"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMeetingAttendee_meetingId_memberKey_key" ON "ChatMeetingAttendee"("meetingId", "memberKey");

-- AddForeignKey
ALTER TABLE "ChatMeeting" ADD CONSTRAINT "ChatMeeting_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMeeting" ADD CONSTRAINT "ChatMeeting_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMeetingAttendee" ADD CONSTRAINT "ChatMeetingAttendee_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "ChatMeeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;
