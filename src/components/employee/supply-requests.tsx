"use client";

import { useState, useTransition } from "react";
import { Check, Clock, Package, ShoppingCart, X } from "lucide-react";
import { cancelSupplyRequest, createSupplyRequest } from "@/lib/actions/operations-actions";
import type { SupplyRequestStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

const STATUS = {
  PENDING: { label: "Waiting for approval", tone: "bg-amber-500/10 text-amber-700 border-amber-500/20", icon: Clock },
  APPROVED: { label: "Approved", tone: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20", icon: Check },
  REJECTED: { label: "Not approved", tone: "bg-ink/5 text-ink/50 border-ink/10", icon: X },
  PURCHASED: { label: "Bought", tone: "bg-cyan/10 text-cyan-strong border-cyan/20", icon: ShoppingCart },
} as const;

export function SupplyRequestForm() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          try {
            await createSupplyRequest(formData);
            // Clearing by hand: the form is uncontrolled, so a successful
            // submit should leave it empty for the next request.
            (document.getElementById("supply-form") as HTMLFormElement | null)?.reset();
          } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : "Could not send that.");
          }
        })
      }
      id="supply-form"
      className="glass flex flex-col gap-3 rounded-2xl p-4"
    >
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <Package size={15} strokeWidth={2} />
        Request something for the office
      </h2>

      <input
        name="item"
        required
        placeholder="What do you need? e.g. Coffee, A4 paper"
        className="rounded-xl border border-ink/12 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-cyan-strong"
      />

      <div className="grid grid-cols-2 gap-2">
        <input
          name="quantity"
          placeholder="How much (2 boxes)"
          className="rounded-xl border border-ink/12 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-cyan-strong"
        />
        <input
          name="estimatedCost"
          type="number"
          step="0.01"
          min="0"
          placeholder="Approx. cost (JOD)"
          className="rounded-xl border border-ink/12 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-cyan-strong"
        />
      </div>

      <textarea
        name="note"
        rows={2}
        placeholder="Anything else the manager should know"
        className="rounded-xl border border-ink/12 bg-white/80 px-3 py-2.5 text-sm outline-none focus:border-cyan-strong"
      />

      <label className="flex items-center gap-2.5 text-sm text-ink/70">
        <input type="checkbox" name="urgent" className="h-5 w-5 accent-[var(--cyan-strong)]" />
        We need this urgently
      </label>

      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-full bg-ink text-sm font-medium text-bg disabled:opacity-60"
      >
        {pending ? "Sending…" : "Send request"}
      </button>
    </form>
  );
}

export function SupplyRequestList({
  requests,
}: {
  requests: {
    id: string;
    item: string;
    quantity: string | null;
    note: string | null;
    estimatedCost: number | null;
    urgent: boolean;
    status: SupplyRequestStatus;
    decisionNote: string | null;
    createdAt: Date;
  }[];
}) {
  const [, startTransition] = useTransition();

  if (requests.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-4 py-8 text-center text-sm text-ink/45">
        Nothing requested yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {requests.map((request) => {
        const status = STATUS[request.status];
        const Icon = status.icon;

        return (
          <div key={request.id} className="glass rounded-2xl p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">
                  {request.item}
                  {request.quantity && <span className="ml-1.5 font-normal text-ink/50">{request.quantity}</span>}
                </p>
                {request.note && <p className="mt-1 text-sm text-ink/60">{request.note}</p>}
                {request.decisionNote && (
                  <p className="mt-1.5 text-xs text-ink/50">Manager: {request.decisionNote}</p>
                )}
              </div>

              {request.urgent && (
                <span className="shrink-0 rounded-full border border-pink/20 bg-pink/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-pink-strong">
                  Urgent
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  status.tone
                )}
              >
                <Icon size={11} strokeWidth={2.5} />
                {status.label}
              </span>

              {request.estimatedCost != null && (
                <span className="text-[11px] text-ink/45">≈ {request.estimatedCost.toFixed(2)} JOD</span>
              )}

              {request.status === "PENDING" && (
                <button
                  type="button"
                  onClick={() => startTransition(() => cancelSupplyRequest(request.id))}
                  className="ml-auto text-[11px] font-medium text-ink/40 hover:text-red-600"
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
