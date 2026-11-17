"use client";

import { useState } from "react";
import { Check, FileDown, Loader2, X } from "lucide-react";

// Choose which renders go into a PDF, then download it (lib/gallery-pdf.ts —
// the same document the client's page gives, cover and all). Asked for on
// 2026-11-17: "بدي خيار انزل مجموعة صور معينة مش كلهم".
//
// Folded away until it is wanted, so the gallery screen stays the editor it is.

type Space = { id: string; name: string; images: { id: string; imageUrl: string; caption: string | null }[] };

export function GalleryPdfPicker({
  pdfPath,
  spaces,
  watermarkDefault,
}: {
  /** The route that makes the PDF: the manager's or the team's, each checking its own session. */
  pdfPath: string;
  spaces: Space[];
  watermarkDefault: boolean;
}) {
  const withImages = spaces.filter((space) => space.images.length > 0);
  const allIds = withImages.flatMap((space) => space.images.map((image) => image.id));

  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [watermark, setWatermark] = useState(watermarkDefault);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (allIds.length === 0) return null;

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const setMany = (ids: string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function download() {
    if (busy || picked.size === 0) return;
    setBusy(true);
    setError(null);
    try {
      // In the gallery's order, whatever order they were ticked in; the route
      // keeps that order anyway.
      const ids = allIds.filter((id) => picked.has(id)).join(",");
      const response = await fetch(
        `${pdfPath}?ids=${ids}&watermark=${watermark ? "1" : "0"}`
      );
      if (!response.ok) throw new Error((await response.text()) || "The PDF couldn't be made.");

      const blob = await response.blob();
      const name =
        /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "Gallery.pdf";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : "The PDF couldn't be made. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass inline-flex items-center gap-2 self-start rounded-2xl px-4 py-3 text-sm font-semibold text-ink"
      >
        <FileDown size={16} strokeWidth={2.25} />
        Download photos as PDF
      </button>
    );
  }

  return (
    <section className="glass rounded-2xl p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-ink">Choose photos for the PDF</h3>
          <p className="mt-0.5 text-sm text-ink/55">
            Tap the ones you want. The PDF opens with a cover, then one photo a page, room by room.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="rounded-full p-1.5 text-ink/50 hover:bg-ink/5"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={() => setMany(allIds, true)} className="font-medium text-cyan-700 underline">
          Select all
        </button>
        <button type="button" onClick={() => setPicked(new Set())} className="font-medium text-cyan-700 underline">
          Clear
        </button>
        <label className="ml-auto inline-flex items-center gap-2 text-ink/70">
          <input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} />
          NEON watermark
        </label>
      </div>

      {withImages.map((space) => {
        const ids = space.images.map((image) => image.id);
        const all = ids.every((id) => picked.has(id));
        return (
          <div key={space.id} className="mt-5">
            <div className="flex items-center gap-3">
              <h4 className="text-sm font-semibold text-ink">{space.name}</h4>
              <button
                type="button"
                onClick={() => setMany(ids, !all)}
                className="text-xs font-medium text-cyan-700 underline"
              >
                {all ? "None from this room" : "All from this room"}
              </button>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {space.images.map((image) => {
                const on = picked.has(image.id);
                return (
                  <button
                    key={image.id}
                    type="button"
                    onClick={() => toggle(image.id)}
                    aria-pressed={on}
                    title={image.caption ?? space.name}
                    className={`relative aspect-[4/3] overflow-hidden rounded-lg border-2 transition ${
                      on ? "border-cyan-600" : "border-transparent opacity-70 hover:opacity-100"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- thumbnails of the studio's own uploads */}
                    <img src={image.imageUrl} alt={image.caption ?? space.name} className="h-full w-full object-cover" loading="lazy" />
                    {on && (
                      <span className="absolute right-1 top-1 rounded-full bg-cyan-600 p-0.5 text-white">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={download}
          disabled={busy || picked.size === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <FileDown size={16} strokeWidth={2.25} />}
          {busy
            ? "Making the PDF…"
            : picked.size === 0
              ? "Choose photos first"
              : `Download PDF · ${picked.size} photo${picked.size === 1 ? "" : "s"}`}
        </button>
        {error && <p className="text-sm font-medium text-red-700">{error}</p>}
      </div>
    </section>
  );
}
