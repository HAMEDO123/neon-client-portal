"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { Check, ExternalLink, Loader2, Star } from "lucide-react";
import { savePortfolio, type PortfolioResult } from "@/lib/actions/portfolio-actions";
import { cn } from "@/lib/utils";
import { PORTFOLIO_CATEGORIES } from "@/lib/portfolio";

// One project's place on the public portfolio (lib/portfolio.ts): shown or
// not, the title and words clients read, which photos, and which is the cover.
// Ticking is done here, in the browser; nothing is saved until Save.

type Photo = { id: string; imageUrl: string; caption: string | null; inPortfolio: boolean };
type Room = { id: string; name: string; images: Photo[] };

export function PortfolioEditor({
  projectId,
  shown,
  title,
  note,
  category,
  place,
  coverId,
  rooms,
  publicUrl,
}: {
  projectId: string;
  shown: boolean;
  title: string;
  note: string;
  category: string;
  place: string;
  coverId: string | null;
  rooms: Room[];
  publicUrl: string;
}) {
  const withPhotos = rooms.filter((room) => room.images.length > 0);
  const [picked, setPicked] = useState(
    () => new Set(withPhotos.flatMap((room) => room.images.filter((image) => image.inPortfolio).map((image) => image.id)))
  );
  const [cover, setCover] = useState<string | null>(coverId);
  const [state, save, saving] = useActionState<PortfolioResult, FormData>(savePortfolio.bind(null, projectId), null);

  const setMany = (ids: string[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  const shownCover = cover && picked.has(cover) ? cover : withPhotos.flatMap((room) => room.images).find((image) => picked.has(image.id))?.id;

  if (withPhotos.length === 0) {
    return (
      <section className="glass rounded-2xl p-6 text-sm text-ink/60">
        This project has no photos yet. Add them on the Gallery tab, then choose which go on the portfolio here.
      </section>
    );
  }

  return (
    <form action={save} className="flex flex-col gap-6">
      {[...picked].map((id) => (
        <input key={id} type="hidden" name="photo" value={id} />
      ))}
      <input type="hidden" name="cover" value={shownCover ?? ""} />

      <section className="glass flex flex-col gap-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">On the portfolio</h3>
            <p className="mt-0.5 text-sm text-ink/55">
              The link you send clients to show NEON&apos;s work. They see only the title, the words below and the photos you tick —
              never the client&apos;s name, phone, prices or drawings.
            </p>
          </div>
          <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-cyan-700 underline">
            Open the portfolio <ExternalLink size={14} />
          </a>
        </div>

        <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <input type="checkbox" name="shown" defaultChecked={shown} className="h-4 w-4" />
          Show this project on the portfolio
        </label>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink">Title clients see</span>
          <input
            name="title"
            defaultValue={title}
            maxLength={120}
            placeholder="e.g. Villa — Dabouq"
            className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink"
          />
          <span className="text-xs text-ink/50">Not the client&apos;s name. Something like the kind of place and the area.</span>
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">Kind of project</span>
            <select name="category" defaultValue={category} className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink">
              <option value="">Not set</option>
              {PORTFOLIO_CATEGORIES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <span className="text-xs text-ink/50">Clients can filter the portfolio by it.</span>
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium text-ink">Where (optional)</span>
            <input
              name="place"
              defaultValue={place}
              maxLength={80}
              placeholder="e.g. Dabouq, Amman"
              className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink"
            />
            <span className="text-xs text-ink/50">The area, never the street or building.</span>
          </label>
        </div>

        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium text-ink">A line or two about it (optional)</span>
          <textarea
            name="note"
            defaultValue={note}
            maxLength={1000}
            rows={3}
            placeholder="Warm modern living spaces with walnut joinery and a marble kitchen."
            className="rounded-xl border border-ink/10 bg-white px-3 py-2 text-ink"
          />
        </label>
      </section>

      <section className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-ink">Photos</h3>
          <span className="text-sm text-ink/55">
            {picked.size === 0
              ? "None ticked — the portfolio shows 12 from across the rooms by itself, new uploads included"
              : `${picked.size} ticked · tap a photo to tick it, the star makes it the cover`}
          </span>
          <button type="button" onClick={() => setPicked(new Set())} className="ms-auto text-sm font-medium text-cyan-700 underline">
            Clear
          </button>
        </div>

        {withPhotos.map((room) => {
          const ids = room.images.map((image) => image.id);
          const all = ids.every((id) => picked.has(id));
          return (
            <div key={room.id} className="mt-5">
              <div className="flex items-center gap-3">
                <h4 className="text-sm font-semibold text-ink">{room.name}</h4>
                <button type="button" onClick={() => setMany(ids, !all)} className="text-xs font-medium text-cyan-700 underline">
                  {all ? "None from this room" : "All from this room"}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                {room.images.map((image) => {
                  const on = picked.has(image.id);
                  const isCover = on && image.id === shownCover;
                  return (
                    <div key={image.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setMany([image.id], !on)}
                        aria-pressed={on}
                        className={cn(
                          "relative block aspect-[4/3] w-full overflow-hidden rounded-lg border-2 transition",
                          on ? "border-clay" : "border-transparent opacity-60 hover:opacity-100"
                        )}
                      >
                        <Image src={image.imageUrl} alt={image.caption ?? room.name} fill unoptimized className="object-cover" />
                        {on && (
                          <span className="absolute end-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-clay text-white">
                            <Check size={12} strokeWidth={3} />
                          </span>
                        )}
                      </button>
                      {on && (
                        <button
                          type="button"
                          onClick={() => setCover(image.id)}
                          aria-label="Make this the cover"
                          title="Make this the cover"
                          className={cn(
                            "absolute bottom-1 start-1 flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
                            isCover ? "bg-amber-400 text-ink" : "bg-ink/60 text-white"
                          )}
                        >
                          <Star size={10} fill={isCover ? "currentColor" : "none"} />
                          {isCover ? "Cover" : ""}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>

      {/* Kept in reach: a project can have a hundred photos above it. */}
      <div className="glass-strong sticky bottom-4 z-10 flex flex-wrap items-center gap-3 self-start rounded-full px-3 py-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-bg disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save
        </button>
        {state && <span className={cn("text-sm", state.ok ? "text-emerald-700" : "text-red-700")}>{state.message}</span>}
      </div>
    </form>
  );
}
