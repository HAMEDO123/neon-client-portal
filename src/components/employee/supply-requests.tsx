"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Clock, Package, Plus, ShoppingCart, X } from "lucide-react";
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
  // One box per thing being bought. Ids rather than a count, so removing the
  // middle one does not renumber the two around it and wipe what was typed in
  // them — React would reuse the inputs by position.
  const [lines, setLines] = useState<number[]>([0]);
  const nextLine = useRef(1);

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
            setLines([0]);
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
        Ask to buy something
      </h2>

      {/* One box per thing. A shop run is five things decided in one go, and
          five separate requests makes the manager answer the same question
          five times and lose the fact that they belong together. */}
      <div className="flex flex-col gap-2">
        {lines.map((id, index) => (
          <div key={id} className="rounded-xl border border-ink/10 bg-white/60 p-2.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold tabular-nums text-ink/30">{index + 1}</span>
              <input
                name="lineName"
                required={index === 0}
                dir="auto"
                placeholder="What to buy — e.g. Coffee"
                className="min-w-0 flex-1 rounded-lg border border-ink/12 bg-white/80 px-3 py-2 text-sm outline-none focus:border-cyan-strong"
              />
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((line) => line !== id))}
                  aria-label={`Remove item ${index + 1}`}
                  className="shrink-0 rounded-lg p-1.5 text-ink/30 hover:bg-ink/5 hover:text-ink/60"
                >
                  <X size={14} strokeWidth={2} />
                </button>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 pl-5">
              <label className="flex items-center gap-2 rounded-lg border border-ink/12 bg-white/80 px-3 py-2 focus-within:border-cyan-strong">
                <span className="shrink-0 text-xs text-ink/40">How many</span>
                <input
                  name="lineCount"
                  type="number"
                  min="1"
                  step="1"
                  // A phone shows the number pad for this rather than the
                  // keyboard, which is the whole reason it is a count.
                  inputMode="numeric"
                  placeholder="1"
                  className="w-full min-w-0 bg-transparent text-sm tabular-nums outline-none"
                />
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-ink/12 bg-white/80 px-3 py-2 focus-within:border-cyan-strong">
                <span className="shrink-0 text-xs text-ink/40">Price</span>
                <input
                  name="lineCost"
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="w-full min-w-0 bg-transparent text-sm tabular-nums outline-none"
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <p className="-mt-1 pl-1 text-[11px] text-ink/40">
        Price is for the whole line, not for one.
      </p>

      <button
        type="button"
        onClick={() =>
          setLines((current) => {
            const id = nextLine.current;
            nextLine.current += 1;
            return [...current, id];
          })
        }
        className="flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-ink/15 py-2.5 text-xs font-medium text-ink/55 active:bg-white/60"
      >
        <Plus size={14} strokeWidth={2.5} />
        Add another thing
      </button>

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
    lines: { id: string; name: string; count: number | null; estimatedCost: number | null }[];
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

                {/* More than one thing is worth listing; a single one is
                    already the line above, and repeating it reads as a bug. */}
                {request.lines.length > 1 && (
                  <ul className="mt-1.5 flex flex-col gap-0.5">
                    {request.lines.map((line) => (
                      <li key={line.id} dir="auto" className="text-sm text-ink/60">
                        · {line.name}
                        {line.count != null && <span className="text-ink/40"> &times;{line.count}</span>}
                        {line.estimatedCost != null && (
                          <span className="text-ink/40"> — {line.estimatedCost.toFixed(2)} JOD</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

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
