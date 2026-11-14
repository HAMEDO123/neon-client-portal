"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, FileText, ImageUp, Loader2, X } from "lucide-react";
import { submitTaskCompletion } from "@/lib/actions/submission-actions";
import { submitAssignedTaskCompletion } from "@/lib/actions/my-assigned-actions";
import { cn } from "@/lib/utils";
import { shrinkPhoto } from "@/lib/client-image";
import { isPictureFile, PROOF_ACCEPT } from "@/lib/attachments";
import { shownError } from "@/lib/refusal";

// Finishing a task means showing it.
//
// There is no button here that marks work done on its own: the employee picks
// a photo — the camera on a phone, a screenshot from the gallery — and sends
// it to the manager. The task then reads "sent for review" until the manager
// looks at the picture.
//
// Not all proof is a picture. A quotation, a drawing, a material schedule: the
// finished thing *is* the file, and photographing a screen of it was the only
// way to hand it in. Anything storage accepts as a document can be sent now,
// and only actual images go through the shrinker on the way.

export function CompletionForm({
  entryId,
  state,
  kind = "entry",
  evidence = null,
}: {
  entryId: string;
  state: "TODO" | "IN_PROGRESS" | "SUBMITTED" | "DONE" | "TOMORROW";
  /** A cell on the project board, or a job the manager handed out by hand. */
  kind?: "entry" | "assigned";
  /**
   * What proof this kind of work is supposed to come with, where the step says
   * so. Shown above the camera rather than below it: telling somebody what to
   * photograph after they have photographed something is advice that arrived
   * too late.
   */
  evidence?: string | null;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Two inputs, because a phone treats them differently: `capture` opens the
  // camera straight away, without it you get the photo library.
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Ctrl+V. On a computer the proof is usually a screenshot already on the
  // clipboard, and saving it to a file only to pick that file again was two
  // steps of nothing. Listened for on the whole page, not just the form, so it
  // works without clicking anywhere first.
  useEffect(() => {
    if (state === "DONE" || pending) return;

    function onPaste(event: ClipboardEvent) {
      const data = event.clipboardData;
      const pasted = data?.files?.[0];
      if (!pasted || !isProofFile(pasted)) return;

      // Typing somewhere else on the page — the question box below — is that
      // box's paste, not proof for this task.
      const target = event.target instanceof Element ? event.target : null;
      const field = target?.closest("textarea, input, [contenteditable='true']");
      if (field && !formRef.current?.contains(field)) return;
      // In the note itself, text wins: copying cells from Excel puts both the
      // text and a picture of them on the clipboard.
      if (field && data?.getData("text/plain")) return;

      event.preventDefault();
      pick(pasted);
    }

    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  });

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
    // Pasting again replaces what was there, with no X pressed in between.
    if (preview) URL.revokeObjectURL(preview);
    setError(null);
    setFile(chosen);
    // Only a picture gets an object URL. Pointing an <img> at a PDF draws a
    // broken icon, which reads as "it did not work" — the file gets its name
    // on a card instead.
    setPreview(isPictureFile(chosen) ? URL.createObjectURL(chosen) : null);
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
      setError("Take a photo or pick a file first.");
      return;
    }
    start(async () => {
      try {
        // Shrunk on the phone first: uploading a 4MB photo was most of the wait.
        // A PDF goes up as it is — shrinkPhoto draws to a canvas, which would
        // turn any other kind of file into a blank image or throw.
        formData.set("photo", isPictureFile(file) ? await shrinkPhoto(file) : file);
        if (kind === "assigned") await submitAssignedTaskCompletion(entryId, formData);
        else await submitTaskCompletion(entryId, formData);
        clear();
      } catch (cause) {
        setError(shownError(cause, "Could not send it. Try again."));
      }
    });
  }

  return (
    <form ref={formRef} action={send} className="glass rounded-2xl p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/40">
        {state === "SUBMITTED" ? "Send something else" : "Finished? Send the proof"}
      </h2>
      <p className="mt-1 text-xs text-ink/50">
        {state === "SUBMITTED"
          ? "What you sent is with the manager. You can add a better photo or file while you wait."
          : "A photo of the finished work, a screenshot, or the file itself — PDF, drawing or spreadsheet. The manager reviews it and marks the task complete."}
      </p>

      {evidence && (
        <p dir="auto" className="mt-2 rounded-lg border border-ink/10 bg-white/60 px-3 py-2 text-xs text-ink/70">
          <span className="font-semibold text-ink/45">Send: </span>
          {evidence}
        </p>
      )}

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
        accept={PROOF_ACCEPT}
        hidden
        onChange={(event) => pick(event.target.files?.[0])}
      />

      {file ? (
        <div className="relative mt-3 overflow-hidden rounded-xl border border-ink/10">
          {preview ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={preview} alt="The work you are sending" className="max-h-64 w-full object-cover" />
          ) : (
            <div className="flex items-center gap-3 bg-white/60 px-4 py-5">
              <FileText size={22} strokeWidth={1.75} className="shrink-0 text-ink/45" />
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink/80">{file.name}</p>
                <p className="text-xs text-ink/45">Ready to send</p>
              </div>
            </div>
          )}
          <button
            type="button"
            onClick={clear}
            aria-label="Remove what you picked"
            className="absolute right-2 top-2 rounded-full bg-ink/70 p-1.5 text-white backdrop-blur"
          >
            <X size={14} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Picker icon={Camera} label="Take photo" onClick={() => cameraRef.current?.click()} />
          <Picker icon={ImageUp} label="Choose file" onClick={() => libraryRef.current?.click()} />
          {/* Only where there is a keyboard and a mouse: a phone has no Ctrl+V. */}
          <p className="col-span-2 hidden text-center text-xs text-ink/40 pointer-fine:block">
            Or paste a screenshot with <kbd className="rounded border border-ink/15 bg-white/70 px-1 font-sans">Ctrl</kbd>+
            <kbd className="rounded border border-ink/15 bg-white/70 px-1 font-sans">V</kbd>
          </p>
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

/**
 * Whether something pasted is a kind of proof the pickers would have offered —
 * the same list as `PROOF_ACCEPT`, so pasting is never a way round it.
 */
function isProofFile(file: File): boolean {
  if (isPictureFile(file)) return true;
  const extension = file.name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0];
  return extension != null && PROOF_ACCEPT.split(",").includes(extension);
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
