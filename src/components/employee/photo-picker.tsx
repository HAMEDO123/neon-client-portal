"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";
import { PersonAvatar } from "@/components/chat/person-avatar";
import { compressInBrowser } from "@/lib/client-image-compress";
import { shownError } from "@/lib/refusal";

// Setting somebody's face. One component for both sides: the manager uses it on
// an employee's page, the person uses it on their own profile, and the only
// difference is which action it is handed — so the wording, the shrinking and
// the "remove" path cannot drift between the two.

/**
 * Smaller before it is sent, and **never** able to stop it being sent.
 *
 * The server squares and re-encodes whatever arrives, so this only saves a
 * phone from pushing a five-megabyte original up a mobile connection: a step
 * worth taking and never worth failing on.
 *
 * It is `compressInBrowser` rather than `shrinkPhoto` for one reason, and it
 * cost an afternoon: `shrinkPhoto` waits on an `<img>` load event, and an
 * iPhone photo the browser will not decode fires **neither** `load` nor
 * `error` — so the promise never settles, the button sits at "Saving…" for
 * ever, and nothing reaches the server to be logged. `createImageBitmap`
 * settles either way. The race is belt and braces on top of that: whatever
 * happens, the original goes after eight seconds.
 */
async function shrink(file: File): Promise<File> {
  try {
    return await Promise.race([
      compressInBrowser(file),
      new Promise<File>((resolve) => setTimeout(() => resolve(file), 8000)),
    ]);
  } catch {
    return file;
  }
}

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
        setError(shownError(submitError, "That photo could not be saved."));
      }
    });
  }

  function pick(file: File | undefined) {
    if (!file) return;
    setError(null);

    startTransition(async () => {
      try {
        const formData = new FormData();
        formData.set("photo", await shrink(file));
        await action(formData);
      } catch (submitError) {
        setError(shownError(submitError, "That photo could not be saved."));
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
        hidden
        onChange={(event) => pick(event.target.files?.[0])}
      />
    </div>
  );
}
