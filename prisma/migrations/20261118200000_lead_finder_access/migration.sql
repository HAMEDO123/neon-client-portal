-- Who on the team may open Lead Finder from their portal. Off for everybody
-- until the manager ticks them.
ALTER TABLE "Employee" ADD COLUMN "canUseLeadFinder" BOOLEAN NOT NULL DEFAULT false;
