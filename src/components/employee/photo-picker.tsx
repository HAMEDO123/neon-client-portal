"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { shrinkPhoto } from "@/lib/client-image";

// Setting somebody's face. One component for both sides: the manager uses it on
// an employee's page, the person uses it on their own profile, and the only
// difference is which action it is handed — so the wording, the shrinking and
// the "remove" path cannot drift between the two.

export function PhotoPicker({
  name,
  photo,
  color,
  action,
  hint,
}: {
  name: string;
  photo: string | null;
  color?: string | null;
  /** `setEmployeePhoto.bind(null, id)` on the manager's side, `setMyPhoto` on the person's own. */
  action: (formData: FormData) => Promise<void>;
  hint?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  function send(formData: FormData) {
    startTransition(async () => {
      setError(null);
      try {
        await action(formData);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "That photo could not be saved.");
      }
    });
  }

  function pick(file: File | undefined) {
    if (!file) return;
    startTransition(async () => {
      setError(null);
      try {
        // Shrunk here before it is sent, for the reason the project uploader
        // documents: the request body limit applies to the raw upload, and a
        // modern phone's camera photo is several megabytes of a face that ends
        // up 512 pixels wide.
        const small = await shrinkPhoto(file);
        const formData = new FormData();
        formData.set("photo", small);
        await action(formData);
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : "That photo could not be saved.");
      } finally {
        // So picking the same file twice in a row still fires a change.
        if (input.current) input.current.value = "";
      }
    });
  }

  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={pending}
        className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-strong"
        aria-label={photo ? `Change ${name}'s photo` : `Add a photo for ${name}`}
      >
        <PersonAvatar name={name} photo={photo} color={color} size={72} />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100">
          {pending ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} strokeWidth={2} />}
        </span>
      </button>

      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={pending}
            className="rounded-full border border-ink/12 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-ink/5 disabled:opacity-60"
          >
            {pending ? "Saving…" : photo ? "Change photo" : "Add a photo"}
          </button>

          {photo && !pending && (
            <button
              type="button"
              // An empty form is the remove: the action reads no file and
              // writes null, which is the state everybody starts in.
              onClick={() => send(new FormData())}
              className="inline-flex items-center gap-1 text-xs font-medium text-ink/40 hover:text-red-600"
            >
              <Trash2 size={12} strokeWidth={2} />
              Remove
            </button>
          )}
        </div>

        <p className="mt-1.5 text-xs text-ink/45">
          {hint ?? "Shown in chat, on task cards and in calls. Without one, their initials are used."}
        </p>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => pick(event.target.files?.[0])}
      />
    </div>
  );
}
