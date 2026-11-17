"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, MapPin } from "lucide-react";
import { clockFromApp } from "@/lib/actions/app-clock-actions";
import { whileBusy } from "@/lib/busy";
import { shownError } from "@/lib/refusal";

// Clock in or out from here, with where "here" is (lib/app-clock.ts).
//
// The position is asked for fresh every time — never a cached one, which could
// be from the drive over — and nothing is sent without it: the place is what
// makes a clock-in from anywhere worth anything.

type Props = { label: string };

function positionNow(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("This browser can't share your location. Open NEON in Safari or Chrome and try again."));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, {
      enableHighAccuracy: true,
      timeout: 20_000,
      maximumAge: 0,
    });
  });
}

function sayPositionError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as GeolocationPositionError).code;
    if (code === 1) {
      return "Location is blocked for NEON. Allow location for clients.neonjo.com in your phone's settings, then try again.";
    }
    if (code === 3) return "Your location took too long to come through. Step outside if you can and try again.";
    return "Your phone couldn't find where you are. Turn location on and try again.";
  }
  return error instanceof Error ? error.message : "Your location didn't come through. Try again.";
}

export function AppClockButton({ label }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<"locating" | "saving" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function clock() {
    if (busy) return;
    setError(null);
    setDone(null);

    setBusy("locating");
    let position: GeolocationPosition;
    try {
      position = await positionNow();
    } catch (cause) {
      setError(sayPositionError(cause));
      setBusy(null);
      return;
    }

    setBusy("saving");
    try {
      // Held against the live refresh, which would otherwise cancel it midway (lib/busy.ts).
      const answer = await whileBusy(() =>
        clockFromApp({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
          fixedAt: new Date(position.timestamp).toISOString(),
        })
      );
      if (answer.ok) {
        setDone(`Recorded at ${answer.time}, with your location.`);
        router.refresh();
      } else {
        setError(answer.error);
      }
    } catch (cause) {
      setError(shownError(cause, "That didn't go through. Check your internet and try again."));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={clock}
        disabled={busy !== null}
        className="inline-flex items-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <MapPin size={16} strokeWidth={2.25} />}
        {busy === "locating" ? "Finding where you are…" : busy === "saving" ? "Recording…" : label}
      </button>
      {done && <p className="mt-2 text-xs font-medium text-emerald-700">{done}</p>}
      {error && <p className="mt-2 text-xs font-medium text-red-700">{error}</p>}
    </div>
  );
}
