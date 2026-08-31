import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { GalleryGrid } from "@/components/client/gallery-grid";
import { BeforeAfterSlider } from "@/components/client/before-after-slider";
import { EmptyState } from "@/components/ui/empty-state";
import { Images } from "lucide-react";
import type { FullProject } from "@/lib/queries";

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
  const nonEmptySpaces = spaces.filter((s) => s.images.length > 0);

  return (
    <SectionShell id="gallery">
      <SectionHeader
        eyebrow="Explore"
        title="Design Gallery"
        description="Every space, rendered in detail. Tap any image to view it fullscreen."
      />

      {nonEmptySpaces.length === 0 ? (
        <EmptyState className="mt-8" icon={Images} title="Renders coming soon" description="The design gallery will appear here once NEON uploads the first renders." />
      ) : (
        <>
          <div className="scrollbar-none mt-8 flex gap-2 overflow-x-auto">
            {nonEmptySpaces.map((space) => (
              <a
                key={space.id}
                href={`#space-${space.id}`}
                className="shrink-0 rounded-full border border-ink/10 bg-white/50 px-4 py-2 text-xs font-medium text-ink/60 transition-colors hover:border-cyan-strong hover:text-cyan-strong"
              >
                {space.name}
                <span className="ml-1.5 text-ink/30">{space.images.length}</span>
              </a>
            ))}
          </div>

          <div className="mt-8 flex flex-col gap-16">
            {nonEmptySpaces.map((space) => {
              const pairs = space.images.filter((i) => i.isBeforeAfter && i.beforeImageUrl);
              const singles = space.images.filter((i) => !(i.isBeforeAfter && i.beforeImageUrl));

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
                      <GalleryGrid
                        images={singles.map((img) => ({
                          url: img.imageUrl,
                          caption: img.caption,
                          downloadUrl: allowDownloads ? `/p/${token}/dl/image/${img.id}` : null,
                          hotspots: img.hotspots,
                        }))}
                        watermark={watermark}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </SectionShell>
  );
}
