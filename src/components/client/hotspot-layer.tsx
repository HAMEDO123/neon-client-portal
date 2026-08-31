"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { Badge } from "@/components/ui/badge";

export interface Hotspot {
  id: string;
  xPercent: number;
  yPercent: number;
  label: string;
  description: string | null;
  category: string | null;
  linkLabel: string | null;
}

export function HotspotLayer({ hotspots }: { hotspots: Hotspot[] }) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = hotspots.find((h) => h.id === activeId) ?? null;

  return (
    <>
      {hotspots.map((h) => (
        <button
          key={h.id}
          onClick={(e) => {
            e.stopPropagation();
            setActiveId(activeId === h.id ? null : h.id);
          }}
          className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: `${h.xPercent}%`, top: `${h.yPercent}%` }}
          aria-label={h.label}
        >
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/40" />
          <span className="relative flex h-4 w-4 items-center justify-center rounded-full bg-white text-ink shadow-lg">
            <Plus size={11} strokeWidth={3} />
          </span>
        </button>
      ))}

      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            onClick={(e) => e.stopPropagation()}
            className="glass-strong absolute z-10 w-56 rounded-2xl p-4 text-left"
            style={{
              left: `${Math.min(Math.max(active.xPercent, 15), 85)}%`,
              top: `${active.yPercent}%`,
              transform: `translate(-50%, ${active.yPercent > 55 ? "-120%" : "20%"})`,
            }}
          >
            <button
              onClick={() => setActiveId(null)}
              className="absolute right-2 top-2 rounded-full p-1 text-ink/40 hover:bg-ink/5"
            >
              <X size={13} />
            </button>
            {active.category && (
              <Badge tone="cyan" className="mb-1.5">
                {active.category}
              </Badge>
            )}
            <p className="pr-4 text-sm font-medium text-ink">{active.label}</p>
            {active.description && <p className="mt-1 text-xs text-ink/60">{active.description}</p>}
            {active.linkLabel && <p className="mt-1.5 text-[11px] text-ink/40">Ref: {active.linkLabel}</p>}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
