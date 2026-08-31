"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { X, ChevronLeft, ChevronRight, Presentation } from "lucide-react";
import { cn } from "@/lib/utils";

export type Slide =
  | { kind: "cover"; eyebrow: string; title: string; subtitle?: string; image?: string | null }
  | { kind: "image"; title: string; subtitle?: string; image: string }
  | { kind: "text"; title: string; body: string }
  | { kind: "grid"; title: string; items: { image?: string | null; label: string; sub?: string }[] }
  | { kind: "stat"; title: string; value: string; sub?: string }
  | { kind: "cta"; title: string; subtitle?: string; ctaLabel: string; ctaHref: string };

export function PresentationTrigger({ slides }: { slides: Slide[] }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/5 px-6 py-3 text-sm font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/15"
      >
        <Presentation size={15} />
        Presentation Mode
      </button>
      {open && <PresentationMode slides={slides} onClose={() => setOpen(false)} />}
    </>
  );
}

function PresentationMode({ slides, onClose }: { slides: Slide[]; onClose: () => void }) {
  const [index, setIndex] = useState(0);
  const slide = slides[index];

  const go = useCallback(
    (delta: number) => setIndex((i) => Math.min(Math.max(i + delta, 0), slides.length - 1)),
    [slides.length]
  );

  useEffect(() => {
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
  }, [onClose, go]);

  return (
    <div className="fixed inset-0 z-[90] flex flex-col bg-ink text-white">
      <div className="flex items-center justify-between px-5 py-4 sm:px-8">
        <div className="flex gap-1.5">
          {slides.map((_, i) => (
            <span
              key={i}
              className={cn("h-1 w-6 rounded-full transition-colors sm:w-10", i === index ? "bg-white" : "bg-white/20")}
            />
          ))}
        </div>
        <button onClick={onClose} className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white" aria-label="Exit presentation">
          <X size={20} />
        </button>
      </div>

      <div className="relative flex flex-1 items-center justify-center overflow-hidden px-6 pb-10 sm:px-16">
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          className="absolute left-2 z-10 rounded-full p-2.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-20 sm:left-6"
        >
          <ChevronLeft size={26} />
        </button>

        <AnimatePresence mode="wait">
          <motion.div
            key={index}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.4 }}
            className="flex h-full w-full max-w-5xl items-center justify-center"
          >
            <SlideView slide={slide} onCtaClick={onClose} />
          </motion.div>
        </AnimatePresence>

        <button
          onClick={() => go(1)}
          disabled={index === slides.length - 1}
          className="absolute right-2 z-10 rounded-full p-2.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-20 sm:right-6"
        >
          <ChevronRight size={26} />
        </button>
      </div>
    </div>
  );
}

function SlideView({ slide, onCtaClick }: { slide: Slide; onCtaClick: () => void }) {
  switch (slide.kind) {
    case "cover":
      return (
        <div className="relative flex h-full w-full items-end overflow-hidden rounded-3xl">
          {slide.image ? (
            <Image src={slide.image} alt={slide.title} fill unoptimized className="object-cover" />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-strong/30 to-purple-strong/30" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/40 to-transparent" />
          <div className="relative z-10 p-8 sm:p-12">
            <p className="text-xs font-bold uppercase tracking-[0.3em] text-white/60">{slide.eyebrow}</p>
            <h2 className="mt-3 text-3xl font-semibold sm:text-5xl">{slide.title}</h2>
            {slide.subtitle && <p className="mt-3 max-w-lg text-white/70">{slide.subtitle}</p>}
          </div>
        </div>
      );
    case "image":
      return (
        <div className="relative flex h-full w-full items-end overflow-hidden rounded-3xl">
          <Image src={slide.image} alt={slide.title} fill unoptimized className="object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink/90 via-ink/10 to-transparent" />
          <div className="relative z-10 p-8">
            <h3 className="text-2xl font-semibold sm:text-3xl">{slide.title}</h3>
            {slide.subtitle && <p className="mt-1 text-white/60">{slide.subtitle}</p>}
          </div>
        </div>
      );
    case "text":
      return (
        <div className="mx-auto max-w-2xl text-center">
          <h3 className="text-3xl font-semibold sm:text-4xl">{slide.title}</h3>
          <p className="mt-6 text-lg leading-relaxed text-white/65">{slide.body}</p>
        </div>
      );
    case "grid":
      return (
        <div className="w-full">
          <h3 className="text-center text-2xl font-semibold sm:text-3xl">{slide.title}</h3>
          <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
            {slide.items.slice(0, 8).map((item, i) => (
              <div key={i} className="overflow-hidden rounded-2xl bg-white/5">
                <div className="relative aspect-square">
                  {item.image && <Image src={item.image} alt={item.label} fill unoptimized className="object-cover" />}
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  {item.sub && <p className="truncate text-xs text-white/45">{item.sub}</p>}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    case "stat":
      return (
        <div className="text-center">
          <p className="text-sm font-medium uppercase tracking-wider text-white/50">{slide.title}</p>
          <p className="text-gradient-neon mt-4 text-5xl font-bold sm:text-7xl">{slide.value}</p>
          {slide.sub && <p className="mt-4 text-white/60">{slide.sub}</p>}
        </div>
      );
    case "cta":
      return (
        <div className="text-center">
          <h3 className="text-3xl font-semibold sm:text-4xl">{slide.title}</h3>
          {slide.subtitle && <p className="mt-4 text-white/60">{slide.subtitle}</p>}
          <Link
            href={slide.ctaHref}
            onClick={onCtaClick}
            className="mt-8 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-sm font-medium text-ink transition-transform hover:scale-105"
          >
            {slide.ctaLabel}
          </Link>
        </div>
      );
  }
}
