"use client";

import { useState } from "react";
import Image from "next/image";
import { X, MapPin } from "lucide-react";
import { createHotspot, deleteHotspot } from "@/lib/actions/hotspot-actions";
import { Select, TextInput } from "@/components/admin/fields";
import { SaveButton } from "@/components/admin/form-buttons";
import { buttonClasses } from "@/components/ui/buttons";
import { HOTSPOT_CATEGORIES, toOptions } from "@/lib/constants";
import { cn } from "@/lib/utils";

export interface HotspotData {
  id: string;
  xPercent: number;
  yPercent: number;
  label: string;
  description: string | null;
  category: string | null;
  linkLabel: string | null;
}

export function HotspotEditor({
  projectId,
  imageId,
  imageUrl,
  hotspots,
}: {
  projectId: string;
  imageId: string;
  imageUrl: string;
  hotspots: HotspotData[];
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-2 left-2 flex items-center gap-1 rounded-full bg-ink/70 px-2.5 py-1 text-[10px] font-medium text-white opacity-0 transition-opacity group-hover:opacity-100"
      >
        <MapPin size={11} />
        Hotspots {hotspots.length > 0 && `(${hotspots.length})`}
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-ink/70 p-4 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass-strong flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl"
          >
            <div className="flex items-center justify-between border-b border-ink/8 px-5 py-3">
              <p className="text-sm font-medium text-ink">Click the image to place a hotspot</p>
              <button onClick={() => setOpen(false)} className="rounded-full p-1.5 text-ink/40 hover:bg-ink/5">
                <X size={16} />
              </button>
            </div>

            <div className="overflow-y-auto p-5">
              <div
                className="relative w-full cursor-crosshair overflow-hidden rounded-2xl bg-ink/5"
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = ((e.clientX - rect.left) / rect.width) * 100;
                  const y = ((e.clientY - rect.top) / rect.height) * 100;
                  setPending({ x, y });
                }}
              >
                <Image src={imageUrl} alt="" width={1200} height={750} unoptimized className="pointer-events-none h-auto w-full" />
                {hotspots.map((h, i) => (
                  <div
                    key={h.id}
                    className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-cyan-strong text-[10px] font-bold text-white shadow-lg"
                    style={{ left: `${h.xPercent}%`, top: `${h.yPercent}%` }}
                  >
                    {i + 1}
                  </div>
                ))}
                {pending && (
                  <div
                    className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-pulse rounded-full border-2 border-dashed border-pink-strong"
                    style={{ left: `${pending.x}%`, top: `${pending.y}%` }}
                  />
                )}
              </div>

              {pending && (
                <form
                  action={async (formData) => {
                    await createHotspot(projectId, imageId, pending.x, pending.y, formData);
                    setPending(null);
                  }}
                  className="mt-4 grid grid-cols-1 gap-3 rounded-xl border border-dashed border-ink/12 p-4 sm:grid-cols-2"
                >
                  <TextInput label="Label" name="label" placeholder="Sofa" defaultValue="" />
                  <Select label="Category" name="category" defaultValue="Note" options={toOptions(HOTSPOT_CATEGORIES)} />
                  <TextInput
                    label="Reference (e.g. material/furniture name)"
                    name="linkLabel"
                    defaultValue=""
                    required={false}
                  />
                  <TextInput label="Description" name="description" defaultValue="" required={false} />
                  <div className="flex gap-2 sm:col-span-2">
                    <SaveButton label="Add Hotspot" />
                    <button
                      type="button"
                      onClick={() => setPending(null)}
                      className={buttonClasses("ghost", "sm")}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}

              {hotspots.length > 0 && (
                <div className="mt-4 flex flex-col gap-1.5">
                  {hotspots.map((h, i) => (
                    <div key={h.id} className={cn("flex items-center gap-3 rounded-lg bg-ink/[0.03] px-3 py-2 text-xs")}>
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-cyan-strong text-[10px] font-bold text-white">
                        {i + 1}
                      </span>
                      <span className="flex-1 text-ink/70">
                        <strong className="text-ink">{h.label}</strong>
                        {h.category && <span className="text-ink/40"> · {h.category}</span>}
                        {h.description && <span className="text-ink/50"> — {h.description}</span>}
                      </span>
                      <form>
                        <button
                          formAction={deleteHotspot.bind(null, projectId, h.id)}
                          className="shrink-0 text-red-500 hover:text-red-600"
                        >
                          Remove
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
