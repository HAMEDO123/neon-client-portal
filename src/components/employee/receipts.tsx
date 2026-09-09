"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Camera, Loader, Receipt, Trash2 } from "lucide-react";
import { deleteReceipt, submitReceipt } from "@/lib/actions/operations-actions";
import type { ReceiptStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

// Photographing a receipt. The upload and the reading happen in one action,
// so the employee waits once and sees the result rather than a row that fills
// itself in later.

export function ReceiptUploader() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    const formData = new FormData();
    formData.set("photo", file);

    startTransition(async () => {
      setError(null);
      try {
        await submitReceipt(formData);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Could not upload that photo.");
      } finally {
        if (inputRef.current) inputRef.current.value = "";
      }
    });
  }

  return (
    <div className="glass rounded-2xl p-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        // Opens the camera directly on a phone rather than the photo library.
        capture="environment"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
        }}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-ink text-sm font-medium text-bg disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader size={17} className="animate-spin" strokeWidth={2} />
            Reading the receipt…
          </>
        ) : (
          <>
            <Camera size={18} strokeWidth={2} />
            Photograph a receipt
          </>
        )}
      </button>

      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      <p className="mt-2 text-[11px] text-ink/40">
        The total is read from the photo automatically. Check it afterwards — the manager can correct it.
      </p>
    </div>
  );
}

export function ReceiptList({
  receipts,
}: {
  receipts: {
    id: string;
    imageUrl: string;
    status: ReceiptStatus;
    vendor: string | null;
    receiptDate: Date | null;
    rawAmount: number | null;
    countedAmount: number | null;
    currency: string;
    summary: string | null;
    aiNotes: string | null;
    createdAt: Date;
  }[];
}) {
  const [, startTransition] = useTransition();

  if (receipts.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-ink/12 bg-ink/[0.02] px-4 py-8 text-center text-sm text-ink/45">
        No receipts this month yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {receipts.map((receipt) => {
        const capped =
          receipt.rawAmount != null &&
          receipt.countedAmount != null &&
          receipt.countedAmount < receipt.rawAmount;

        return (
          <div key={receipt.id} className="glass flex gap-3 rounded-2xl p-3">
            <a href={receipt.imageUrl} target="_blank" rel="noreferrer" className="shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={receipt.imageUrl}
                alt="Receipt"
                className="h-20 w-16 rounded-lg object-cover"
              />
            </a>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">
                    {receipt.vendor ?? (receipt.status === "FAILED" ? "Could not read" : "Receipt")}
                  </p>
                  {receipt.summary && <p className="truncate text-xs text-ink/50">{receipt.summary}</p>}
                </div>

                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-ink">
                    {receipt.countedAmount != null ? `${receipt.countedAmount.toFixed(2)}` : "—"}
                    <span className="ml-1 text-[11px] font-normal text-ink/45">{receipt.currency}</span>
                  </p>
                  {capped && (
                    <p className="text-[10px] text-ink/40">of {receipt.rawAmount?.toFixed(2)} paid</p>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2">
                {receipt.status === "FAILED" && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    <AlertTriangle size={10} strokeWidth={2.5} />
                    Needs a manual amount
                  </span>
                )}
                {receipt.status === "PENDING" && (
                  <span className="inline-flex items-center gap-1 text-[10px] text-ink/40">
                    <Receipt size={10} strokeWidth={2} />
                    Not read yet
                  </span>
                )}
                {receipt.receiptDate && (
                  <span className="text-[10px] text-ink/40">
                    {receipt.receiptDate.toISOString().slice(0, 10)}
                  </span>
                )}

                <button
                  type="button"
                  onClick={() => {
                    if (confirm("Remove this receipt?")) {
                      startTransition(() => deleteReceipt(receipt.id));
                    }
                  }}
                  aria-label="Remove receipt"
                  className={cn("ml-auto text-ink/25 hover:text-red-600")}
                >
                  <Trash2 size={13} strokeWidth={2} />
                </button>
              </div>

              {receipt.aiNotes && receipt.status !== "ANALYZED" && (
                <p className="mt-1.5 text-[11px] text-ink/45">{receipt.aiNotes}</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
