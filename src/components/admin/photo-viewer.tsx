"use client";

import { createContext, useContext, useState } from "react";
import { Lightbox, type LightboxImage } from "@/components/client/lightbox";
import { cn } from "@/lib/utils";

// Tapping a photo on a project's Gallery tab opens it large (2026-11-28: "خليني
// اقدر اكبس عصورة تكبر"). The room is the viewer's list, so the arrows and a
// swipe go through that room's photos. It is the client page's own viewer, so
// zoom and full screen behave the same on both sides.
//
// The tiles stay server-rendered with their delete and hotspot controls on top;
// only the picture itself is the button, reaching the viewer through context.

const OpenAt = createContext<((index: number) => void) | null>(null);

export function PhotoViewer({
  images,
  children,
}: {
  images: LightboxImage[];
  children: React.ReactNode;
}) {
  const [index, setIndex] = useState<number | null>(null);
  return (
    <OpenAt.Provider value={setIndex}>
      {children}
      <Lightbox
        images={images}
        index={index}
        onClose={() => setIndex(null)}
        onNavigate={setIndex}
      />
    </OpenAt.Provider>
  );
}

export function PhotoViewerOpen({
  index,
  className,
  children,
}: {
  index: number;
  className?: string;
  children: React.ReactNode;
}) {
  const open = useContext(OpenAt);
  return (
    <button
      type="button"
      onClick={() => open?.(index)}
      aria-label="View photo"
      className={cn("block w-full cursor-zoom-in", className)}
    >
      {children}
    </button>
  );
}
