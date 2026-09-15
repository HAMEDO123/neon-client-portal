-- CreateEnum
CREATE TYPE "CallKind" AS ENUM ('AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "CallParticipantState" AS ENUM ('INVITED', 'JOINED', 'LEFT', 'DECLINED');

-- AlterEnum
ALTER TYPE "ChatMessageKind" ADD VALUE 'CALL';

-- CreateTable
CREATE TABLE "Call" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "kind" "CallKind" NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "startedByKey" TEXT NOT NULL,
    "startedByName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "messageId" TEXT,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallParticipant" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "memberKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT,
    "state" "CallParticipantState" NOT NULL DEFAULT 'INVITED',
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "CallParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallSignal" (
    "id" SERIAL NOT NULL,
    "callId" TEXT NOT NULL,
    "fromKey" TEXT NOT NULL,
    "toKey" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_messageId_key" ON "Call"("messageId");

-- CreateIndex
CREATE INDEX "Call_channelId_status_idx" ON "Call"("channelId", "status");

-- CreateIndex
CREATE INDEX "Call_status_createdAt_idx" ON "Call"("status", "createdAt");

-- CreateIndex
CREATE INDEX "CallParticipant_memberKey_state_idx" ON "CallParticipant"("memberKey", "state");

-- CreateIndex
CREATE UNIQUE INDEX "CallParticipant_callId_memberKey_key" ON "CallParticipant"("callId", "memberKey");

-- CreateIndex
CREATE INDEX "CallSignal_toKey_id_idx" ON "CallSignal"("toKey", "id");

-- CreateIndex
CREATE INDEX "CallSignal_callId_idx" ON "CallSignal"("callId");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "ChatChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallParticipant" ADD CONSTRAINT "CallParticipant_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallSignal" ADD CONSTRAINT "CallSignal_callId_fkey" FOREIGN KEY ("callId") REFERENCES "Call"("id") ON DELETE CASCADE ON UPDATE CASCADE;
