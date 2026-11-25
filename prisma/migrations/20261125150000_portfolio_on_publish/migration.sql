-- A published project goes on the portfolio by itself, once (Project.portfolioAddedAt).
ALTER TABLE "Project" ADD COLUMN "portfolioAddedAt" TIMESTAMP(3);

-- The projects already on it have been added.
UPDATE "Project" SET "portfolioAddedAt" = CURRENT_TIMESTAMP WHERE "portfolioShown" = true;
