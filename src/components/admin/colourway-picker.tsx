"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { saveColourway } from "@/lib/actions/settings-actions";
import { refusalOf } from "@/lib/ask";
import { COLOURWAY_IDS, COLOURWAYS, type ColourwayId } from "@/lib/colourway";
import { cn } from "@/lib/utils";

// The six colourways (lib/colourway.ts), each drawn in its own colours, for the
// manager to choose between. One press repaints every surface: the root layout
// writes the choice on <html>, this tab follows with the action's answer, and
// every other open page within a couple of seconds.
//
// It never sets the attribute itself as a preview: React owns <html>, and a
// save that was refused would leave the page and React disagreeing.

export function ColourwayPicker({ current }: { current: ColourwayId }) {
  const [busy, setBusy] = useState<ColourwayId | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(id: ColourwayId) {
    if (busy || id === current) return;
    setBusy(id);
    setError(null);
    const refused = await refusalOf(() => saveColourway(id), "That did not go through. Try again.");
    setBusy(null);
    if (refused) setError(refused);
  }

  return (
    <div>
      <div role="radiogroup" aria-label="Colourway" className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {COLOURWAY_IDS.map((id) => {
          const colours = COLOURWAYS[id];
          const chosen = id === current;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => choose(id)}
              disabled={busy !== null}
              className={cn(
                "flex flex-col overflow-hidden rounded-2xl border text-left transition-shadow disabled:cursor-wait",
                chosen ? "border-ink/40 shadow-md ring-2 ring-ink/15" : "border-ink/10 hover:shadow-md"
              )}
            >
              {/* The colourway in miniature: its page, its accent pill, its ink. */}
              <span className="flex h-20 items-end gap-2 p-3" style={{ background: colours.page }}>
                <span className="h-7 w-16 rounded-lg" style={{ background: colours.accent }} />
                <span className="font-display text-2xl leading-none" style={{ color: colours.ink }}>
                  Aa
                </span>
              </span>
              <span className="flex items-start justify-between gap-2 bg-white p-3">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink">{colours.label}</span>
                  <span className="mt-0.5 block text-xs text-ink/55">{colours.feel}</span>
                </span>
                {busy === id ? (
                  <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-ink/50" />
                ) : chosen ? (
                  <Check size={16} strokeWidth={2.5} className="mt-0.5 shrink-0 text-ink" />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
    </div>
  );
}
