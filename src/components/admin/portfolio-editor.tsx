"use client";

import { useActionState, useState } from "react";
import Image from "next/image";
import { Check, ExternalLink, FileText, Loader2, Plus, Star } from "lucide-react";
import { savePortfolio, type PortfolioResult } from "@/lib/actions/portfolio-actions";
import { cn } from "@/lib/utils";
import { drawingKind, PORTFOLIO_CATEGORIES } from "@/lib/portfolio";

// One project's place on the public portfolio (lib/portfolio.ts): shown or
// not, the title and words clients read, which photos, which is the cover, and
// which drawings, under what label.
// Ticking is done here, in the browser; nothing is saved until Save, and the
// bar at the foot says so while there is something unsaved. Every photo shows
// whether it is on (a filled tick) or off (dimmed, with a +), because a tick
// that only appeared on the chosen ones left "how do I choose" unanswered
// (2026-11-26: "التاب مش مفهوم كيف بختار او بشيل").

type Photo = { id: string; imageUrl: string; caption: string | null; inPortfolio: boolean };
type Room = { id: string; name: string; images: Photo[] };
type Drawing = {
  id: string;
  name: string;
  category: string;
  fileUrl: string;
  fileType: string;
  inPortfolio: boolean;
  portfolioLabel: string | null;
};

export function PortfolioEditor({
  projectId,
  shown,
  title,
  note,
  category,
  place,
  coverId,
  rooms,
  drawings,
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
  drawings: Drawing[];
  publicUrl: string;
}) {
  const withPhotos = rooms.filter((room) => room.images.length > 0);
  const [picked, setPicked] = useState(
    () => new Set(withPhotos.flatMap((room) => room.images.filter((image) => image.inPortfolio).map((image) => image.id)))
  );
  const [cover, setCover] = useState<string | null>(coverId);
  const [pickedDrawings, setPickedDrawings] = useState(() => new Set(drawings.filter((d) => d.inPortfolio).map((d) => d.id)));
  // Anything changed since the last save: the bar at the foot says so.
  const [dirty, setDirty] = useState(false);
  const toggleDrawing = (id: string) => {
    setDirty(true);
    setPickedDrawings((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const [state, save, saving] = useActionState<PortfolioResult, FormData>(async (before, form) => {
    const result = await savePortfolio(projectId, before, form);
    if (result?.ok) setDirty(false);
    return result;
  }, null);

  const allPhotos = withPhotos.flatMap((room) => room.images);
  const setMany = (ids: string[], on: boolean) => {
    setDirty(true);
    setPicked((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const shownCover = cover && picked.has(cover) ? cover : withPhotos.flatMap((room) => room.images).find((image) => picked.has(image.id))?.id;
  // The cover clients see first, drawn at the top of the photos (2026-11-26: "put the cover photo on top here").
  // With nothing ticked the portfolio chooses, and its first photo is the first of the first room.
  const coverPhoto = allPhotos.find((image) => image.id === shownCover) ?? (picked.size === 0 ? allPhotos[0] : undefined);

  if (withPhotos.length === 0) {
    return (
      <section className="glass rounded-2xl p-6 text-sm text-ink/60">
        This project has no photos yet. Add them on the Gallery tab, then choose which go on the portfolio here.
      </section>
    );
  }

  return (
    <form action={save} onChange={() => setDirty(true)} className="flex flex-col gap-6">
      {[...picked].map((id) => (
        <input key={id} type="hidden" name="photo" value={id} />
      ))}
      <input type="hidden" name="cover" value={shownCover ?? ""} />
      {[...pickedDrawings].map((id) => (
        <input key={id} type="hidden" name="drawing" value={id} />
      ))}

      <section className="glass flex flex-col gap-4 rounded-2xl p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">On the portfolio</h3>
            <p className="mt-0.5 text-sm text-ink/55">
              The link you send clients to show NEON&apos;s work. They see only the title, the words below, the photos and the
              drawings you tick — never the client&apos;s name, phone or prices.
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
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-ink">Photos</h3>
            <p className="mt-0.5 text-sm text-ink/60">
              {picked.size === 0
                ? "None chosen, so the portfolio shows 12 from across the rooms by itself."
                : `${picked.size} of ${allPhotos.length} photos on the portfolio.`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setMany(allPhotos.map((image) => image.id), true)}
              className="rounded-full border border-ink/15 bg-white px-3.5 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
            >
              Add all
            </button>
            <button
              type="button"
              onClick={() => setMany(allPhotos.map((image) => image.id), false)}
              className="rounded-full border border-ink/15 bg-white px-3.5 py-1.5 text-sm font-medium text-ink hover:bg-ink/5"
            >
              Remove all
            </button>
          </div>
        </div>

        {coverPhoto && (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-xl border border-amber-300/70 bg-amber-50/60 p-3">
            <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg sm:w-72">
              <Image src={coverPhoto.imageUrl} alt="The cover" fill unoptimized className="object-cover" />
              <span className="absolute start-2 top-2 inline-flex items-center gap-1 rounded-full bg-amber-400 px-2.5 py-1 text-[11px] font-semibold text-ink shadow">
                <Star size={12} fill="currentColor" />
                Cover
              </span>
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="font-semibold text-ink">The cover</p>
              <p className="mt-1 text-ink/65">
                The first photo clients see of this project, on the portfolio and on its own page.
                {picked.size === 0
                  ? " Tick photos below to choose the cover yourself."
                  : " To change it, tap the star on any photo below."}
              </p>
            </div>
          </div>
        )}

        {/* How it works, in the marks the photos themselves wear. */}
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl bg-ink/[0.04] px-4 py-3 text-sm text-ink/75">
          <span className="font-medium text-ink">Tap a photo to add it or remove it.</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-clay text-white">
              <Check size={12} strokeWidth={3} />
            </span>
            On the portfolio
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="flex h-5 w-5 items-center justify-center rounded-full border border-ink/25 bg-white text-ink/60">
              <Plus size={12} strokeWidth={2.5} />
            </span>
            Not on it
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Star size={14} className="text-amber-500" fill="currentColor" />
            The cover, shown first — tap the star on a photo to make it the cover
          </span>
        </div>

        {withPhotos.map((room) => {
          const ids = room.images.map((image) => image.id);
          const on = ids.filter((id) => picked.has(id)).length;
          const all = on === ids.length;
          return (
            <div key={room.id} className="mt-6">
              <div className="flex flex-wrap items-center gap-3">
                <h4 dir="auto" className="text-sm font-semibold text-ink">
                  {room.name}
                </h4>
                <span className="text-xs text-ink/55">
                  {on} of {ids.length} on
                </span>
                <button
                  type="button"
                  onClick={() => setMany(ids, !all)}
                  className="rounded-full border border-ink/15 bg-white px-3 py-1 text-xs font-medium text-ink hover:bg-ink/5"
                >
                  {all ? "Remove this room" : "Add this room"}
                </button>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
                {room.images.map((image) => {
                  const chosen = picked.has(image.id);
                  const isCover = chosen && image.id === shownCover;
                  return (
                    <div key={image.id} className="relative">
                      <button
                        type="button"
                        onClick={() => setMany([image.id], !chosen)}
                        aria-pressed={chosen}
                        aria-label={chosen ? "Remove from the portfolio" : "Add to the portfolio"}
                        title={chosen ? "On the portfolio — tap to remove" : "Not on the portfolio — tap to add"}
                        className={cn(
                          "relative block aspect-[4/3] w-full overflow-hidden rounded-lg ring-offset-2 transition",
                          chosen ? "ring-[3px] ring-clay" : "ring-1 ring-ink/10"
                        )}
                      >
                        <Image
                          src={image.imageUrl}
                          alt={image.caption ?? room.name}
                          fill
                          unoptimized
                          className={cn("object-cover transition", !chosen && "opacity-40 grayscale")}
                        />
                        <span
                          className={cn(
                            "absolute end-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full shadow",
                            chosen ? "bg-clay text-white" : "border border-ink/20 bg-white/90 text-ink/70"
                          )}
                        >
                          {chosen ? <Check size={15} strokeWidth={3} /> : <Plus size={15} strokeWidth={2.5} />}
                        </span>
                      </button>
                      {chosen && (
                        <button
                          type="button"
                          onClick={() => {
                            setDirty(true);
                            setCover(image.id);
                          }}
                          title={isCover ? "This is the cover" : "Make this the cover"}
                          aria-label={isCover ? "This is the cover" : "Make this the cover"}
                          className={cn(
                            "absolute bottom-1.5 start-1.5 flex h-7 items-center gap-1 rounded-full text-[11px] font-semibold shadow",
                            isCover ? "bg-amber-400 px-2.5 text-ink" : "w-7 justify-center bg-black/55 text-white hover:bg-black/75"
                          )}
                        >
                          <Star size={13} fill={isCover ? "currentColor" : "none"} />
                          {isCover && "Cover"}
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

      <section className="glass rounded-2xl p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-base font-semibold text-ink">Drawings</h3>
          <span className="text-sm text-ink/55">
            {drawings.length === 0
              ? "This project has no drawings yet. Add them on the Drawings tab."
              : `${pickedDrawings.size} of ${drawings.length} on the portfolio`}
          </span>
        </div>
        {drawings.length > 0 && (
          <p className="mt-1 text-xs text-ink/55">
            Open each one before ticking it: a drawing&apos;s title block often has the client&apos;s name. Clients see the label you
            write, never the file&apos;s name.
          </p>
        )}
        <ul className="mt-4 flex flex-col divide-y divide-ink/8">
          {drawings.map((drawing) => {
            const kind = drawingKind(drawing.fileType, drawing.fileUrl);
            const on = pickedDrawings.has(drawing.id);
            return (
              <li key={drawing.id} className="flex flex-wrap items-center gap-3 py-3">
                <input type="hidden" name="drawingRow" value={drawing.id} />
                <input
                  type="checkbox"
                  checked={on}
                  disabled={!kind && !on}
                  onChange={() => toggleDrawing(drawing.id)}
                  aria-label={`Show ${drawing.name} on the portfolio`}
                  className="h-4 w-4 shrink-0"
                />
                <a
                  href={drawing.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 flex-1 basis-48 items-center gap-2 text-sm text-ink hover:underline"
                >
                  <FileText size={15} className="shrink-0 text-ink/45" />
                  <span dir="auto" className="truncate font-medium">
                    {drawing.name}
                  </span>
                  <span className="shrink-0 text-xs uppercase text-ink/45">
                    {drawing.category} · {drawing.fileType}
                  </span>
                </a>
                {kind ? (
                  <input
                    name={`drawingLabel:${drawing.id}`}
                    defaultValue={drawing.portfolioLabel ?? ""}
                    maxLength={120}
                    placeholder="Label clients see, e.g. Ground floor plan"
                    className="w-full rounded-xl border border-ink/10 bg-white px-3 py-1.5 text-sm text-ink sm:w-72"
                  />
                ) : (
                  <span className="text-xs text-ink/50">AutoCAD files can&apos;t be opened in a browser. Upload a PDF of it.</span>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {/* Kept in reach: a project can have a hundred photos above it. */}
      <div className="glass-strong sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3">
        <div className="min-w-0 flex-1 text-sm">
          {dirty ? (
            <span className="inline-flex items-center gap-2 font-medium text-amber-700">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              Not saved yet — press Save
            </span>
          ) : state ? (
            <span className={state.ok ? "text-emerald-700" : "text-red-700"}>{state.message}</span>
          ) : (
            <span className="text-ink/60">
              {picked.size === 0 ? "Photos chosen by the portfolio" : `${picked.size} photo${picked.size === 1 ? "" : "s"}`}
              {pickedDrawings.size > 0 && ` · ${pickedDrawings.size} drawing${pickedDrawings.size === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-full bg-ink px-6 py-2.5 text-sm font-semibold text-bg disabled:opacity-60"
        >
          {saving && <Loader2 size={14} className="animate-spin" />}
          Save
        </button>
      </div>
    </form>
  );
}
