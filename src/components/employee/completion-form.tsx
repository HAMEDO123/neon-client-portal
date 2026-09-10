"use client";

import { useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, ImageUp, Loader2, X } from "lucide-react";
import { submitTaskCompletion } from "@/lib/actions/submission-actions";
import { submitAssignedTaskCompletion } from "@/lib/actions/my-assigned-actions";
import { cn } from "@/lib/utils";
import { shrinkPhoto } from "@/lib/client-image";

// Finishing a task means showing it.
//
// There is no button here that marks work done on its own: the employee picks
// a photo — the camera on a phone, a screenshot from the gallery — and sends
// it to the manager. The task then reads "sent for review" until the manager
// looks at the picture.

export function CompletionForm({
  entryId,
  state,
  kind = "entry",
}: {
  entryId: string;
  state: "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE" | "TOMORROW";
  /** A cell on the project board, or a job the manager handed out by hand. */
  kind?: "entry" | "assigned";
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Two inputs, because a phone treats them differently: `capture` opens the
  // camera straight away, without it you get the photo library.
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  if (state === "DONE") {
    return (
      <p className="glass flex items-center gap-2 rounded-2xl p-4 text-sm font-medium text-emerald-700">
        <CheckCircle2 size={18} strokeWidth={2} />
        Approved by the manager.
      </p>
    );
  }

  function pick(chosen: File | undefined) {
    if (!chosen) return;
    setError(null);
    setFile(chosen);
    setPreview(URL.createObjectURL(chosen));
  }

  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null);
    setPreview(null);
    if (cameraRef.current) cameraRef.current.value = "";
    if (libraryRef.current) libraryRef.current.value = "";
  }

  function send(formData: FormData) {
    if (!file) {
      setError("Take a photo or pick a screenshot first.");
      return;
    }
    start(async () => {
      try {
        // Shrunk on the phone first: uploading a 4MB photo was most of the wait.
        formData.set("photo", await shrinkPhoto(file));
        if (kind === "assigned") await submitAssignedTaskCompletion(entryId, formData);
        else await submitTaskCompletion(entryId, formData);
        clear();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not send it. Try again.");
      }
    });
  }

  return (
    <form action={send} className="glass rounded-2xl p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">
        {state === "SUBMITTED" ? "Send another photo" : "Finished? Send the proof"}
      </h2>
      <p className="mt-1 text-xs text-ink/50">
        {state === "SUBMITTED"
          ? "Your photo is with the manager. You can add a better one while you wait."
          : "A photo of the finished work, or a screenshot of it. The manager reviews it and marks the task complete."}
      </p>

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => pick(event.target.files?.[0])}
      />
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => pick(event.target.files?.[0])}
      />

      {preview ? (
        <div className="relative mt-3 overflow-hidden rounded-xl border border-ink/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="The work you are sending" className="max-h-64 w-full object-cover" />
          <button
            type="button"
            onClick={clear}
            aria-label="Remove photo"
            className="absolute right-2 top-2 rounded-full bg-ink/70 p-1.5 text-white backdrop-blur"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Picker icon={Camera} label="Take photo" onClick={() => cameraRef.current?.click()} />
          <Picker icon={ImageUp} label="Choose file" onClick={() => libraryRef.current?.click()} />
        </div>
      )}

      <textarea
        name="note"
        rows={2}
        placeholder="Anything the manager should know (optional)"
        className="mt-3 w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
      />

      {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

      <button
        type="submit"
        disabled={pending || !file}
        className={cn(
          "mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors",
          file ? "bg-emerald-600 text-white" : "bg-ink/8 text-ink/35"
        )}
      >
        {pending ? <Loader2 size={16} className="animate-spin" strokeWidth={2.5} /> : <CheckCircle2 size={16} strokeWidth={2.25} />}
        {pending ? "Sending…" : "Send for review"}
      </button>
    </form>
  );
}

function Picker({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof Camera;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/15 bg-white/60 text-xs font-medium text-ink/55 active:bg-white"
    >
      <Icon size={20} strokeWidth={1.75} />
      {label}
    </button>
  );
}
