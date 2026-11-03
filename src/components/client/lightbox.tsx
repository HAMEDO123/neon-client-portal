"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Download, ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { HotspotLayer, type Hotspot } from "@/components/client/hotspot-layer";
import { WatermarkOverlay } from "@/components/client/watermark-overlay";
import { useI18n } from "@/lib/client-i18n";

export interface LightboxImage {
  url: string;
  caption?: string | null;
  downloadUrl?: string | null;
  hotspots?: Hotspot[];
}

/** How long the way out stays on screen after the picture goes full screen. */
const HINT_MS = 2600;

/**
 * "Only the image": the interface goes away, and on a browser that offers it
 * the page goes properly full screen as well.
 *
 * **The two halves are deliberately separate.** iPhone Safari has no element
 * full screen at all — `requestFullscreen` does not exist outside a `<video>`
 * — and a client opens their link on a phone more often than on anything else.
 * So hiding the interface has to stand on its own, and the browser's real full
 * screen is a bonus where there is one. Calling it unconditionally throws,
 * which is how this would have arrived as "the button does nothing" for
 * exactly the clients it matters most to.
 */
function useImmersive(elementRef: React.RefObject<HTMLDivElement | null>) {
  const [immersive, setImmersive] = useState(false);
  const [hinting, setHinting] = useState(false);

  const enter = useCallback(() => {
    setImmersive(true);
    setHinting(true);
    // Optional call, and a rejected promise is the same outcome as no method at
    // all: the interface is hidden either way.
    void elementRef.current?.requestFullscreen?.().catch(() => {});
  }, [elementRef]);

  const leave = useCallback(() => {
    setImmersive(false);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  }, []);

  // The browser can leave full screen without being asked — Escape, F11, a
  // swipe down — and the interface has to come back with it, or it is hidden
  // with nothing left on screen to bring it back.
  useEffect(() => {
    function onChange() {
      if (!document.fullscreenElement) setImmersive(false);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    if (!hinting) return;
    const timer = setTimeout(() => setHinting(false), HINT_MS);
    return () => clearTimeout(timer);
  }, [hinting]);

  return { immersive, hint: immersive && hinting, enter, leave };
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
  const { t } = useI18n();
  const [zoomed, setZoomed] = useState(false);
  const [naturalRatio, setNaturalRatio] = useState<number | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const { immersive, hint, enter, leave } = useImmersive(overlayRef);
  const open = index !== null;
  const current = open ? images[index] : null;

  // Shutting the picture must not leave the browser full screen with nothing in
  // it. (Taking the element out of the page exits full screen by itself, so
  // this is the tidy path rather than the only one.)
  const close = useCallback(() => {
    leave();
    onClose();
  }, [leave, onClose]);

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
      if (e.key === "Escape") {
        // Full screen, Escape means "give me the interface back", not "shut the
        // picture". In the browser's own full screen it never reaches the page
        // at all — it is handled there, and `fullscreenchange` answers for it —
        // so this branch is what serves a browser that had no full screen to
        // give.
        if (immersive) leave();
        else onClose();
      }
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, go, immersive, leave]);

  const hasHotspots = !!current?.hotspots?.length;

  return (
    <AnimatePresence>
      {open && current && (
        <motion.div
          ref={overlayRef}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`fixed inset-0 z-[70] flex flex-col ${immersive ? "bg-ink" : "bg-ink/97 backdrop-blur-sm"}`}
        >
          {!immersive && (
            <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4">
              <span className="text-xs font-medium text-white/60">
                {index !== null ? index + 1 : 0} / {images.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={enter}
                  className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label={t("Full screen")}
                >
                  <Maximize2 size={18} />
                </button>
                <button
                  onClick={() => setZoomed((z) => !z)}
                  className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label={zoomed ? t("Zoom out") : t("Zoom in")}
                >
                  {zoomed ? <ZoomOut size={18} /> : <ZoomIn size={18} />}
                </button>
                {current.downloadUrl && (
                  <a
                    href={current.downloadUrl}
                    className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    aria-label={t("Download image")}
                  >
                    <Download size={18} />
                  </a>
                )}
                <button
                  onClick={close}
                  className="rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label={t("Close")}
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          )}

          <div
            className={`relative flex flex-1 items-center justify-center overflow-hidden ${immersive ? "" : "px-4 pb-6"}`}
            onClick={immersive ? leave : undefined}
          >
            {!immersive && (
              <button
                onClick={() => go(-1)}
                className="absolute left-2 z-10 rounded-full bg-white/5 p-2 text-white/70 transition-colors hover:bg-white/15 hover:text-white sm:left-6"
                aria-label={t("Previous image")}
              >
                <ChevronLeft size={22} />
              </button>
            )}

            {hasHotspots ? (
              // Fitted to the image's real aspect ratio (not the container's) so hotspot
              // percentages — placed against the raw image in the admin editor — line up.
              <motion.div
                key={current.url}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className={`relative max-h-full ${immersive ? "" : "max-w-5xl"}`}
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
                {/* The pins are interface laid over the picture, so they go with the rest
                    of it — one tap anywhere brings them straight back. The watermark is
                    not: it is the studio's own mark, and it stays on every view. */}
                {!immersive && <HotspotLayer hotspots={current.hotspots ?? []} />}
                {watermark && <WatermarkOverlay />}
              </motion.div>
            ) : (
              <motion.div
                key={current.url}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
                className={`relative h-full w-full ${immersive ? "" : "max-w-5xl cursor-zoom-in"}`}
                // Full screen, a tap is the way out — the container's own handler — rather
                // than a zoom: two meanings for one tap would fire both at once.
                onClick={immersive ? undefined : () => setZoomed((z) => !z)}
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

            {!immersive && (
              <button
                onClick={() => go(1)}
                className="absolute right-2 z-10 rounded-full bg-white/5 p-2 text-white/70 transition-colors hover:bg-white/15 hover:text-white sm:right-6"
                aria-label={t("Next image")}
              >
                <ChevronRight size={22} />
              </button>
            )}
          </div>

          {!immersive && current.caption && (
            <p className="pb-6 text-center text-sm text-white/60">{current.caption}</p>
          )}

          {/* Said once, then gone: a picture filling the screen with no interface on it
              is a dead end to anybody who does not know that a tap undoes it. */}
          <AnimatePresence>
            {hint && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute bottom-8 left-1/2 -translate-x-1/2 rounded-full bg-ink/70 px-4 py-2 text-xs text-white/80 backdrop-blur-sm"
              >
                {t("Tap anywhere to leave full screen")}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
