"use client";

import { useState, useTransition } from "react";
import { Loader2, Scissors } from "lucide-react";
import { applyPerformanceDeductions } from "@/lib/actions/analytics-actions";

// Money leaves someone's pay when this is pressed, so it asks once first.
export function ApplyDeductions({ period, count }: { period: string; count: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function apply() {
    setError(null);
    start(async () => {
      try {
        await applyPerformanceDeductions(period);
        setConfirming(false);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "That did not go through.");
      }
    });
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-pink px-3 py-2 text-sm font-semibold text-white"
      >
        <Scissors size={15} strokeWidth={2.25} />
        Apply {count === 1 ? "the deduction" : `${count} deductions`}
      </button>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={apply}
          className="inline-flex items-center gap-1.5 rounded-lg bg-pink px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? <Loader2 size={15} className="animate-spin" /> : <Scissors size={15} strokeWidth={2.25} />}
          Yes, deduct and notify
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setConfirming(false)}
          className="rounded-lg border border-ink/12 bg-white/70 px-3 py-2 text-sm font-medium text-ink/70 hover:bg-white"
        >
          Cancel
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-pink-strong">{error}</p>}
    </div>
  );
}
