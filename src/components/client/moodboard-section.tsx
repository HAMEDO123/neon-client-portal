"use client";

import Image from "next/image";
import { SectionShell } from "@/components/client/section-shell";
import { SectionHeader } from "@/components/ui/section-header";
import { WatermarkOverlay } from "@/components/client/watermark-overlay";
import { useI18n } from "@/lib/client-i18n";
import { cn } from "@/lib/utils";

// The project at a glance: the pieces it is made of, laid out as a board
// rather than a list.
//
// **It draws from whatever the project actually has.** Materials and furniture
// first, because a moodboard is properly a board of materials — then renders,
// because every project has renders from its first day while a schedule is
// filled in later, and a board that stays empty until somebody fills one in is
// a board nobody ever sees. As the schedule grows the board becomes the swatch
// board it wants to be, with nothing here to change.

export type BoardMaterial = {
  id: string;
  name: string;
  imageUrl: string | null;
  brand: string | null;
  finish: string | null;
};

export type BoardFurniture = { id: string; name: string; imageUrl: string | null; brand: string | null };

export type BoardSpace = { id: string; name: string; images: { id: string; imageUrl: string }[] };

type Tile = { key: string; imageUrl: string; title: string | null; subtitle: string | null };

/** How many pieces the board holds before it stops being a glance. */
const MAX_TILES = 11;
/** How many renders deep to go in any one space. */
const MAX_DEPTH = 4;

function boardTiles(materials: BoardMaterial[], furniture: BoardFurniture[], spaces: BoardSpace[]): Tile[] {
  const chosen: Tile[] = [
    ...materials
      .filter((material) => material.imageUrl)
      .map((material) => ({
        key: `material-${material.id}`,
        imageUrl: material.imageUrl as string,
        title: material.name,
        subtitle: [material.brand, material.finish].filter(Boolean).join(" · ") || null,
      })),
    ...furniture
      .filter((item) => item.imageUrl)
      .map((item) => ({
        key: `furniture-${item.id}`,
        imageUrl: item.imageUrl as string,
        title: item.name,
        subtitle: item.brand,
      })),
  ];

  // One render from every space before a second from any of them, so a board
  // made of renders shows the whole project rather than four angles of one room.
  const withRenders = spaces.filter((space) => space.images.length > 0);
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    for (const space of withRenders) {
      const image = space.images[depth];
      if (image) {
        chosen.push({ key: `render-${image.id}`, imageUrl: image.imageUrl, title: null, subtitle: space.name });
      }
    }
  }

  return chosen.slice(0, MAX_TILES);
}

/**
 * Which pieces get more room.
 *
 * The first is the one the board is built around; after that a couple of wider
 * and taller tiles break up the grid. Written as whole class names because
 * Tailwind reads the source for them — a class assembled from a variable is a
 * class that is never generated.
 */
function spanOf(index: number) {
  if (index === 0) return "col-span-2 row-span-2 sm:col-span-3";
  if (index % 5 === 2) return "sm:col-span-2";
  if (index % 7 === 4) return "sm:row-span-2";
  return "";
}

export function MoodboardSection({
  materials,
  furniture,
  spaces,
  watermark = false,
}: {
  materials: BoardMaterial[];
  furniture: BoardFurniture[];
  spaces: BoardSpace[];
  watermark?: boolean;
}) {
  const { t } = useI18n();
  const tiles = boardTiles(materials, furniture, spaces);

  // Nothing to show is not a section. The page simply does not have one.
  if (tiles.length === 0) return null;

  return (
    <SectionShell id="moodboard">
      <SectionHeader
        eyebrow={t("The look")}
        title={t("Moodboard")}
        description={t("The materials, finishes and spaces that set the tone for your project.")}
      />

      {/* A tray rather than a page. The board sits in a shallow recess and each
          piece is framed inside it, which is what makes a grid read as a board
          instead of a gallery that lost its captions. */}
      <div className="mt-8 rounded-3xl bg-ink/[0.04] p-3 ring-1 ring-inset ring-ink/10 sm:p-4">
        <div className="grid auto-rows-[92px] grid-flow-dense grid-cols-2 gap-3 sm:auto-rows-[124px] sm:grid-cols-6">
          {tiles.map((tile, index) => {
            // A caption on every render would label four tiles "Kitchen" and
            // say nothing; a material's own name is the point of showing it.
            const captioned = tile.title !== null || index === 0;

            return (
              <figure
                key={tile.key}
                className={cn(
                  "relative overflow-hidden rounded-xl bg-ink/5 ring-1 ring-inset ring-ink/10",
                  spanOf(index)
                )}
              >
                <Image
                  src={tile.imageUrl}
                  alt={tile.title ?? tile.subtitle ?? ""}
                  fill
                  className="object-cover"
                  unoptimized
                />
                {watermark && <WatermarkOverlay />}

                {captioned && (tile.title || tile.subtitle) && (
                  <figcaption className="absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-ink/85 via-ink/45 to-transparent p-2.5 pt-7">
                    {tile.title && (
                      <span className="block truncate text-[11px] font-semibold leading-tight text-bg">{tile.title}</span>
                    )}
                    {tile.subtitle && (
                      <span className="block truncate text-[10px] leading-tight text-bg/70">{tile.subtitle}</span>
                    )}
                  </figcaption>
                )}
              </figure>
            );
          })}
        </div>
      </div>
    </SectionShell>
  );
}
