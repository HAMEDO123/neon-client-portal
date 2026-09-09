"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Undo2 } from "lucide-react";
import { approveSubmission, rejectSubmission } from "@/lib/actions/submission-actions";

// Accept or send back, and say why.
//
// The note is optional on an approval and worth insisting on for a rejection —
// the employee is told the reason, so "no" without one is just a task that
// reappears with no explanation.
export function ReviewActions({ submissionId }: { submissionId: string }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(kind: "approve" | "reject") {
    if (kind === "reject" && note.trim().length === 0) {
      setError("Tell them what needs redoing.");
      return;
    }
    setError(null);

    const formData = new FormData();
    formData.set("reviewNote", note);

    start(async () => {
      try {
        if (kind === "approve") await approveSubmission(submissionId, formData);
        else await rejectSubmission(submissionId, formData);
        setNote("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not go through.");
      }
    });
  }

  return (
    <div>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="A note for them (required to send back)"
        className="w-full rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
      />

      {error && <p className="mt-1.5 text-xs font-medium text-pink-strong">{error}</p>}

      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run("approve")}
          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} strokeWidth={2.5} />}
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run("reject")}
          className="inline-flex items-center gap-1.5 rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm font-semibold text-ink/70 hover:bg-white disabled:opacity-60"
        >
          <Undo2 size={15} strokeWidth={2.25} />
          Send back
        </button>
      </div>
    </div>
  );
}
