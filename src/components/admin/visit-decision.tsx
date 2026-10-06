"use client";

import { useState, useTransition } from "react";
import { Check, Undo2 } from "lucide-react";
import { approveSiteVisit, reopenSiteVisit } from "@/lib/actions/site-visit-actions";
import { refusalOf } from "@/lib/ask";
import type { Answer } from "@/lib/refusal";

// The manager's two words on a finished visit.
//
// A visit is not done because somebody went — it is done when the manager says
// so, on the client's own answer. That is the studio's rule for finished work
// and this is the same shape: whoever did it makes a claim, and the person
// paying for it decides.
//
// Sending it back does not delete the account that was written. Work sent back
// has never meant work erased.

export function VisitDecision({ id }: { id: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<Answer>) {
    setError(null);
    start(async () => {
      setError(await refusalOf(action, "That did not save. Try again."));
    });
  }

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => approveSiteVisit(id))}
          className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-60"
        >
          <Check size={14} strokeWidth={2.5} />
          Approve
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => reopenSiteVisit(id))}
          className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 bg-white px-3 py-2 text-xs font-medium text-ink/70 disabled:opacity-60"
        >
          <Undo2 size={14} strokeWidth={2} />
          Send back
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-pink-strong">{error}</p>}
    </div>
  );
}
