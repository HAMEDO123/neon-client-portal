"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut } from "lucide-react";
import { HotspotLayer, type Hotspot } from "@/components/client/hotspot-layer";
import { WatermarkOverlay } from "@/components/client/watermark-overlay";

export interface LightboxImage {
  url: string;
  caption?: string | null;
  downloadUrl?: string | null;
  hotspots?: Hotspot[];
}

export function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
  watermark = false,
}: {
  images: LightboxImage[];
  index: number | null;
  onClose: () => void;
  onNavigate: (index: number) => void;
  watermark?: boolean;
}) {
  const [zoomed, setZoomed] = useState(false);
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);
  const open = index !== null;
  const current = open ? images[index] : null;

  const go = useCallback(
    (delta: number) => {
      if (index === null) return;
      const next = (index + delta + images.length) % images.length;
      setZoomed(false);
      setNaturalRatio(null);
      onNavigate(next);
    },
    [index, images.length, onNavigate]
  );

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, go]);

  const hasHotspots = !!current?.hotspots?.length;

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex flex-col bg-ink/97 backdrop-blur-sm"
        >
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
            <span className="text-xs font-medium text-white/60">
              {index !== null ? index + 1 : 0} / {images.length}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setZoomed((z) => !z)}
                className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label={zoomed ? "Zoom out" : "Zoom in"}
              >
                {zoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
              </button>
              {current.downloadUrl && (
                <a
                  href={current.downloadUrl}
                  className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Download image"
                >
                  <Download size={18} />
                </a>
              )}
              <button
                onClick={onClose}
                className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>
          </div>

          <div className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-6">
            <button
              onClick={() => go(-1)}
              className="absolute left-2 z-10 rounded-full bg-white/5 p-2 text-white/70 transition-colors hover:bg-white/15 hover:text-white sm:left-6"
              aria-label="Previous image"
            >
              <ChevronLeft size={22} />
            </button>

            {hasHotspots ? (
              // Fitted to the image's real aspect ratio (not the container's) so hotspot
              // percentages — placed against the raw image in the admin editor — line up.
              <motion.div
                key={current.url}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="relative max-h-full max-w-5xl"
                style={naturalRatio ? { aspectRatio: naturalRatio, width: "100%" } : { width: "100%" }}
              >
                <Image
                  src={current.url}
                  alt={current.caption ?? "Project image"}
                  fill
                  unoptimized
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    if (img.naturalWidth && img.naturalHeight) setNaturalRatio(img.naturalWidth / img.naturalHeight);
                  }}
                  className={`object-contain transition-transform duration-500 ${zoomed ? "scale-150" : "scale-100"}`}
                />
                <HotspotLayer hotspots={current.hotspots ?? []} />
                {watermark && <WatermarkOverlay />}
              </motion.div>
            ) : (
              <motion.div
                key={current.url}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className="relative h-full w-full max-w-5xl cursor-zoom-in"
                onClick={() => setZoomed((z) => !z)}
              >
                <Image
                  src={current.url}
                  alt={current.caption ?? "Project image"}
                  fill
                  unoptimized
                  className={`object-contain transition-transform duration-500 ${zoomed ? "scale-150" : "scale-100"}`}
                />
                {watermark && <WatermarkOverlay />}
              </motion.div>
            )}

            <button
              onClick={() => go(1)}
              className="absolute right-2 z-10 rounded-full bg-white/5 p-2 text-white/70 transition-colors hover:bg-white/15 hover:text-white sm:right-6"
              aria-label="Next image"
            >
              <ChevronRight size={22} />
            </button>
          </div>

          {current.caption && <p className="pb-6 text-center text-sm text-white/60">{current.caption}</p>}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
