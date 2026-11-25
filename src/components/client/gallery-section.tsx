"use client";

import { useState } from "react";
import { SectionShell } from "@/components/client/section-shell";
import { Lightbox, type LightboxImage } from "@/components/client/lightbox";
import { SectionHeader } from "@/components/ui/section-header";
import { GalleryGrid } from "@/components/client/gallery-grid";
import { BeforeAfterSlider } from "@/components/client/before-after-slider";
import { EmptyState } from "@/components/ui/empty-state";
import { Images } from "lucide-react";
import { GalleryPdfButton } from "@/components/client/gallery-pdf-button";
import type { FullProject } from "@/lib/queries";
import { useI18n } from "@/lib/client-i18n";

export function GallerySection({
  spaces,
  allowDownloads,
  token,
  watermark,
}: {
  spaces: FullProject["spaces"];
  allowDownloads: boolean;
  token: string;
  watermark: boolean;
}) {
  const { t } = useI18n();
  const nonEmptySpaces = spaces.filter((s) => s.images.length > 0);

  // One viewer for the whole gallery, so the arrows and a swipe run on from
  // the last render of a room to the first of the next rather than going round
  // one room (2026-11-25: "I want the photos of the spaces to be continued").
  // Each render carries its room's name, so crossing into the next room says so.
  const isPair = (image: (typeof spaces)[number]["images"][number]) => image.isBeforeAfter && !!image.beforeImageUrl;
  const rooms = nonEmptySpaces.map((space) => ({
    space,
    images: space.images.filter((image) => !isPair(image)).map(
      (image): LightboxImage => ({
        url: image.imageUrl,
        caption: image.caption ? `${space.name} · ${image.caption}` : space.name,
        downloadUrl: allowDownloads ? `/p/${token}/dl/image/${image.id}` : null,
        hotspots: image.hotspots,
      })
    ),
  }));
  const everything = rooms.flatMap((room) => room.images);
  const startOf = (roomIndex: number) => rooms.slice(0, roomIndex).reduce((sum, room) => sum + room.images.length, 0);
  const [open, setOpen] = useState<number | null>(null);

  return (
    <SectionShell id="gallery">
      <SectionHeader
        eyebrow={t("Explore")}
        title={t("Design Gallery")}
        description={t("Every space, rendered in detail. Tap any image to view it fullscreen.")}
      />

      {nonEmptySpaces.length === 0 ? (
        <EmptyState className="mt-8" icon={Images} title={t("Renders coming soon")} description={t("The design gallery will appear here once NEON uploads the first renders.")} />
      ) : (
        <>
          {allowDownloads && (
            <div className="mt-6 flex justify-center sm:justify-start">
              <GalleryPdfButton href={`/p/${token}/gallery.pdf`} />
            </div>
          )}

          <div className="scrollbar-none mt-8 flex gap-2 overflow-x-auto">
            {nonEmptySpaces.map((space) => (
              <a
                key={space.id}
                href={`#space-${space.id}`}
                className="shrink-0 rounded-full border border-ink/10 bg-white/50 px-4 py-2 text-xs font-medium text-ink/60 transition-colors hover:border-cyan-strong hover:text-cyan-strong"
              >
                {space.name}
                <span className="ms-1.5 text-ink/30">{space.images.length}</span>
              </a>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-16">
            {nonEmptySpaces.map((space, roomIndex) => {
              const pairs = space.images.filter((i) => isPair(i));
              const singles = rooms[roomIndex].images;

              return (
                <div key={space.id} id={`space-${space.id}`} className="scroll-mt-24">
                  <h3 className="text-xl font-semibold text-ink">{space.name}</h3>

                  {pairs.length > 0 && (
                    <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                      {pairs.map((img) => (
                        <BeforeAfterSlider
                          key={img.id}
                          beforeUrl={img.beforeImageUrl!}
                          afterUrl={img.imageUrl}
                          caption={img.caption}
                          watermark={watermark}
                        />
                      ))}
                    </div>
                  )}

                  {singles.length > 0 && (
                    <div className="mt-4">
                      <GalleryGrid images={singles} watermark={watermark} onOpen={(index) => setOpen(startOf(roomIndex) + index)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <Lightbox images={everything} index={open} onClose={() => setOpen(null)} onNavigate={setOpen} watermark={watermark} />
        </>
      )}
    </SectionShell>
  );
}
