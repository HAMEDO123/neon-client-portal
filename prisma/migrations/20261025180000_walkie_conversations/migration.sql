-- The walkie-talkie's conversations (lib/walkie-store.ts): who spoke to whom,
-- each press as a batch, and when it was heard on the other phone.
ALTER TABLE "WalkieMessage" ADD COLUMN "fromKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WalkieMessage" ADD COLUMN "toKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WalkieMessage" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'one';
ALTER TABLE "WalkieMessage" ADD COLUMN "batch" TEXT NOT NULL DEFAULT '';
ALTER TABLE "WalkieMessage" ADD COLUMN "heardAt" TIMESTAMP(3);

CREATE INDEX "WalkieMessage_fromKey_createdAt_idx" ON "WalkieMessage"("fromKey", "createdAt");
CREATE INDEX "WalkieMessage_toKey_createdAt_idx" ON "WalkieMessage"("toKey", "createdAt");
