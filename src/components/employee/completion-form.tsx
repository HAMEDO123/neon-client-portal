"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import { submitTaskCompletion } from "@/lib/actions/submission-actions";
import { submitAssignedTaskCompletion } from "@/lib/actions/my-assigned-actions";
import { cn } from "@/lib/utils";
import { whileBusy } from "@/lib/busy";
import { isPictureFile, PROOF_ACCEPT } from "@/lib/attachments";
import { shownError } from "@/lib/refusal";
import { ProofPicker, useProofFiles } from "@/components/employee/proof-picker";

// Finishing a task means showing it.
//
// There is no button here that marks work done on its own: the employee picks
// the photos — the camera on a phone, screenshots from the gallery — and sends
// them to the manager. The task then reads "sent for review" until the manager
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
  const files = useProofFiles();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  // Ctrl+V. On a computer the proof is usually a screenshot already on the
  // clipboard, and saving it to a file only to pick that file again was two
  // steps of nothing. Listened for on the whole page, not just the form, so it
  // works without clicking anywhere first.
  useEffect(() => {
    if (state === "DONE" || pending) return;

    function onPaste(event: ClipboardEvent) {
      const data = event.clipboardData;
      const pasted = [...(data?.files ?? [])].filter(isProofFile);
      if (pasted.length === 0) return;

      // Typing somewhere else on the page — the question box below — is that
      // box's paste, not proof for this task.
      const target = event.target instanceof Element ? event.target : null;
      const field = target?.closest("textarea, input, [contenteditable='true']");
      if (field && !formRef.current?.contains(field)) return;
      // In the note itself, text wins: copying cells from Excel puts both the
      // text and a picture of them on the clipboard.
      if (field && data?.getData("text/plain")) return;

      event.preventDefault();
      setError(null);
      files.add(pasted);
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

  const some = files.picked.length > 0;

  function send(formData: FormData) {
    if (!some) {
      setError("Take a photo or pick a file first.");
      return;
    }
    setError(null);
    start(async () => {
      try {
        // Held against the live refresh, which cancels an upload in flight —
        // and several photos are in flight for longer than one was.
        await whileBusy(async () => {
          await files.fill(formData);
          if (kind === "assigned") await submitAssignedTaskCompletion(entryId, formData);
          else await submitTaskCompletion(entryId, formData);
        });
        files.clear();
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
          ? "What you sent is with the manager. You can add better photos or files while you wait."
          : "Photos of the finished work, screenshots, or the files themselves — PDF, drawing or spreadsheet. The manager reviews them and marks the task complete."}
      </p>

      {evidence && (
        <p dir="auto" className="mt-2 rounded-lg border border-ink/10 bg-white/60 px-3 py-2 text-xs text-ink/70">
          <span className="font-semibold text-ink/45">Send: </span>
          {evidence}
        </p>
      )}

      <ProofPicker files={files} disabled={pending} pasteHint />

      <textarea
        name="note"
        rows={2}
        placeholder="Anything the manager should know (optional)"
        className="mt-3 w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
      />

      {error && <p className="mt-2 text-xs font-medium text-pink-strong">{error}</p>}

      <button
        type="submit"
        disabled={pending || !some}
        className={cn(
          "mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors",
          some ? "bg-emerald-600 text-white" : "bg-ink/8 text-ink/35"
        )}
      >
        {pending ? <Loader2 size={16} className="animate-spin" strokeWidth={2.5} /> : <CheckCircle2 size={16} strokeWidth={2.25} />}
        {pending ? "Sending…" : files.picked.length > 1 ? `Send ${files.picked.length} for review` : "Send for review"}
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
