"use client";

import { useEffect } from "react";
import { LIVE_CHANGED } from "@/components/live-sync";
import { markHeard, playCue, unlockSounds } from "@/lib/sound-cues";
import type { ChatSide } from "@/lib/chat-conversations";

// Plays the sound for anything new for whoever is signed in: one sound for a
// message, another for everything else. Renders nothing.
//
// It wakes on the platform heartbeat (see LiveSync), asks /api/cues whether
// the news was theirs, and plays what is new. An open chat plays a message the
// moment it lands; this then finds it already heard and stays quiet.
export function SoundCues({ side }: { side: ChatSide }) {
  useEffect(() => {
    let alive = true;

    const unlock = () => void unlockSounds();
    const gestures = ["touchend", "click", "keydown"] as const;
    for (const name of gestures) window.addEventListener(name, unlock, { passive: true });

    const read = async () => {
      const response = await fetch(`/api/cues?as=${side}`, { cache: "no-store" });
      if (!response.ok) return null;
      return (await response.json()) as { messages: number; updates: number };
    };

    // Whatever had already happened when the page opened is not news.
    const ready = read()
      .then((cues) => {
        if (cues && alive) {
          markHeard("message", cues.messages);
          markHeard("update", cues.updates);
        }
      })
      .catch(() => undefined);

    const onChanged = () => {
      void ready
        .then(read)
        .then((cues) => {
          if (!cues || !alive) return;
          const messaged = playCue("message", cues.messages);
          // Two at once are heard as two, a moment apart.
          if (messaged) setTimeout(() => playCue("update", cues.updates), 450);
          else playCue("update", cues.updates);
        })
        .catch(() => undefined);
    };
    window.addEventListener(LIVE_CHANGED, onChanged);

    return () => {
      alive = false;
      for (const name of gestures) window.removeEventListener(name, unlock);
      window.removeEventListener(LIVE_CHANGED, onChanged);
    };
  }, [side]);

  return null;
}
