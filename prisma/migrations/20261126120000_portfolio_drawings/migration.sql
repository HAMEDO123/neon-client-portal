-- Drawings ticked for the public portfolio, under a public label (lib/portfolio.ts).
ALTER TABLE "Drawing" ADD COLUMN "inPortfolio" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "portfolioLabel" TEXT;
