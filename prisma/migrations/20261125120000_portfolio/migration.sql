-- The studio's public portfolio (/work): which projects, under what title, and which of their photos.
ALTER TABLE "Project" ADD COLUMN "portfolioShown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "portfolioTitle" TEXT,
ADD COLUMN "portfolioNote" TEXT,
ADD COLUMN "portfolioCategory" TEXT,
ADD COLUMN "portfolioPlace" TEXT,
ADD COLUMN "portfolioOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "portfolioCoverId" TEXT;

ALTER TABLE "GalleryImage" ADD COLUMN "inPortfolio" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Project_portfolioShown_portfolioOrder_idx" ON "Project"("portfolioShown", "portfolioOrder");
