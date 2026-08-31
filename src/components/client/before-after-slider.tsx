"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { WatermarkOverlay } from "@/components/client/watermark-overlay";

export function BeforeAfterSlider({
  beforeUrl,
  afterUrl,
  caption,
  watermark = false,
}: {
  beforeUrl: string;
  afterUrl: string;
  caption?: string | null;
  watermark?: boolean;
}) {
  const [percent, setPercent] = useState(50);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  function updateFromClientX(clientX: number) {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPercent(Math.min(100, Math.max(0, pct)));
  }

  return (
    <div className="overflow-hidden rounded-2xl">
      <div
        ref={containerRef}
        className="relative aspect-[16/10] w-full cursor-ew-resize select-none touch-none"
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          updateFromClientX(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && updateFromClientX(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
      >
        <Image src={afterUrl} alt={caption ?? "After"} fill unoptimized className="pointer-events-none object-cover" />
        <div
          className="pointer-events-none absolute inset-0"
          style={{ clipPath: `inset(0 ${100 - percent}% 0 0)` }}
        >
          <Image src={beforeUrl} alt={caption ?? "Before"} fill unoptimized className="object-cover" />
        </div>

        <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-lg" style={{ left: `${percent}%` }}>
          <div className="absolute top-1/2 left-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-ink shadow-lg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M8 6L2 12L8 18M16 6L22 12L16 18" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>

        <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
          Before
        </span>
        <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white">
          After
        </span>
        {watermark && <WatermarkOverlay />}
      </div>
      {caption && <p className="mt-2 text-sm text-ink/50">{caption}</p>}
    </div>
  );
}
