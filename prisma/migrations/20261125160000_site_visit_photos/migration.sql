-- Photos sent from a visit's job are its write-up (lib/site-visit-report.ts).
ALTER TABLE "SiteVisit" ADD COLUMN "photoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];
