-- Two tables schema.prisma has declared since the first commit, which no
-- migration ever created: a database built from the migrations alone (the live
-- one, or a new computer's) went without them. The local database only had
-- them because it was first made with `db push`.
--
-- Written to change nothing wherever they already exist, so it is safe on any
-- database whatever its history.

CREATE TABLE IF NOT EXISTS "ImageHotspot" (
    "id" TEXT NOT NULL,
    "imageId" TEXT NOT NULL,
    "xPercent" DOUBLE PRECISION NOT NULL,
    "yPercent" DOUBLE PRECISION NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "linkLabel" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ImageHotspot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "DrawingRevision" (
    "id" TEXT NOT NULL,
    "drawingId" TEXT NOT NULL,
    "revision" TEXT NOT NULL,
    "note" TEXT,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DrawingRevision_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ImageHotspot_imageId_fkey') THEN
        ALTER TABLE "ImageHotspot" ADD CONSTRAINT "ImageHotspot_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "GalleryImage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DrawingRevision_drawingId_fkey') THEN
        ALTER TABLE "DrawingRevision" ADD CONSTRAINT "DrawingRevision_drawingId_fkey" FOREIGN KEY ("drawingId") REFERENCES "Drawing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
