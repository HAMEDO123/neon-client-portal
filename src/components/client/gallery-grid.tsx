"use client";

import { useState } from "react";
import Image from "next/image";
import { Expand, MapPin } from "lucide-react";
import { Lightbox, type LightboxImage } from "@/components/client/lightbox";
import { WatermarkOverlay } from "@/components/client/watermark-overlay";

export function GalleryGrid({ images, watermark = false }: { images: LightboxImage[]; watermark?: boolean }) {
  const [index, setIndex] = useState<number | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {images.map((img, i) => (
          <button
            key={img.url}
            onClick={() => setIndex(i)}
            className="group relative aspect-[4/3] overflow-hidden rounded-2xl bg-ink/5"
          >
            <Image
              src={img.url}
              alt={img.caption ?? "Project render"}
              fill
              unoptimized
              className="object-cover transition-transform duration-700 group-hover:scale-105"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-ink/0 opacity-0 transition-all duration-300 group-hover:bg-ink/20 group-hover:opacity-100">
              <Expand size={20} className="text-white drop-shadow" />
            </div>
            {!!img.hotspots?.length && (
              <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-ink/70 px-2 py-1 text-[10px] font-medium text-white">
                <MapPin size={10} />
                {img.hotspots.length}
              </span>
            )}
            {watermark && <WatermarkOverlay />}
          </button>
        ))}
      </div>

      <Lightbox images={images} index={index} onClose={() => setIndex(null)} onNavigate={setIndex} watermark={watermark} />
    </>
  );
}
