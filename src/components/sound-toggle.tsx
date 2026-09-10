"use client";

import { useSyncExternalStore } from "react";
import { Bell, MessageCircle, Volume2, VolumeX } from "lucide-react";
import { previewCue, setSoundsOn, soundsOn, subscribeSounds } from "@/lib/sound-cues";
import { cn } from "@/lib/utils";

// The two sounds, and a switch for them. Kept per device, like a phone's own
// volume: the office computer can be quiet while the phone is not.

export function SoundToggle() {
  // Read from the device, and on (the default) while the page is still on the server.
  const on = useSyncExternalStore(subscribeSounds, soundsOn, () => true);

  return (
    <section className="glass rounded-2xl p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-2 text-sm font-medium text-ink">
            {on ? <Volume2 size={16} strokeWidth={2} /> : <VolumeX size={16} strokeWidth={2} />}
            Sounds
          </p>
          <p className="mt-1 text-xs text-ink/50">
            One sound for a message, a different one for everything else, while the app is open. When it is closed,
            your phone plays its own notification sound.
          </p>
        </div>

        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="Sounds"
          onClick={() => {
            setSoundsOn(!on);
            // Turning them on is a tap, which is also what lets the browser play them.
            if (!on) previewCue("message");
          }}
          className={cn(
            "relative h-7 w-12 shrink-0 rounded-full transition-colors",
            on ? "bg-emerald-600" : "bg-ink/15"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-[left]",
              on ? "left-[1.375rem]" : "left-0.5"
            )}
          />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <PreviewButton label="Message sound" icon={MessageCircle} disabled={!on} onClick={() => previewCue("message")} />
        <PreviewButton label="Update sound" icon={Bell} disabled={!on} onClick={() => previewCue("update")} />
      </div>
    </section>
  );
}

function PreviewButton({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: typeof Bell;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 bg-white/70 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-white disabled:opacity-40"
    >
      <Icon size={13} strokeWidth={2} />
      Play {label.toLowerCase()}
    </button>
  );
}
