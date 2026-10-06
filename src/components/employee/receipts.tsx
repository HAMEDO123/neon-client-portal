"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, Camera, ImageUp, Loader, Receipt, Trash2 } from "lucide-react";
import { deleteReceipt, submitReceipt } from "@/lib/actions/operations-actions";
import { lastReply, reportUploadFailure, watchingReply } from "@/lib/action-reply";
import { whileBusy } from "@/lib/busy";
import { compressInBrowser } from "@/lib/client-image-compress";
import { tooBig, uploadFailure } from "@/lib/upload-limits";
import type { ReceiptStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

// Sending in a receipt. The upload and the reading happen in one action, so
// the employee waits once and sees the result rather than a row that fills
// itself in later.
//
// **Two ways in, because a phone treats them differently.** With `capture` the
// phone opens its camera and offers nothing else — so a receipt photographed
// at the till an hour ago, or a screenshot of one that came by message, could
// not be sent at all. This had only the camera, under a button that said
// "Photograph a receipt", and the owner's words for it were "I can't upload
// proof photos for the receipts". The task-proof form learned the same thing
// first and has the same two buttons.
//
// **It goes up the way every other photo here does**, which this one did not:
// shrunk in the browser first (a camera photo is most of the wait, and the
// reading takes several seconds on top), held against the live refresh — a
// `router.refresh()` landing mid-action cancels it, see lib/busy.ts — and, when
// it fails, saying what the browser got back and writing that to the server's
// log (`[upload-failed]`), so the next failure names itself.
//
// The action answers with its refusal rather than throwing it (lib/refusal.ts):
// "that is not a photo" has to reach the person holding the receipt.

export function ReceiptUploader() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);

  function upload(file: File) {
    // Said before anything is sent: a file too large never reaches the server,
    // and what comes back then is a page with no message in it.
    const refusal = tooBig([file]);
    if (refusal) {
      setError(refusal);
      return;
    }

    startTransition(async () => {
      setError(null);
      try {
        const answer = await whileBusy(() =>
          watchingReply(async () => {
            const formData = new FormData();
            formData.set("photo", await compressInBrowser(file));
            return submitReceipt(formData);
          })
        );
        if (!answer.ok) setError(answer.error);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "";
        const reply = lastReply();
        setError(uploadFailure([file], message, reply));
        reportUploadFailure({
          where: "employee-receipt",
          files: [{ name: file.name, size: file.size, type: file.type }],
          message,
          reply,
        });
      } finally {
        if (cameraRef.current) cameraRef.current.value = "";
        if (libraryRef.current) libraryRef.current.value = "";
      }
    });
  }

  return (
    <div className="glass rounded-2xl p-4">
      <input
        ref={cameraRef}
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
      <input
        ref={libraryRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) upload(file);
        }}
      />

      {pending ? (
        <p className="flex h-14 w-full items-center justify-center gap-2.5 rounded-xl bg-ink text-sm font-medium text-bg opacity-70">
          <Loader size={17} className="animate-spin" strokeWidth={2} />
          Reading the receipt…
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-ink text-sm font-medium text-bg"
          >
            <Camera size={18} strokeWidth={2} />
            Take a photo
          </button>
          <button
            type="button"
            onClick={() => libraryRef.current?.click()}
            className="flex h-14 items-center justify-center gap-2 rounded-xl border border-ink/15 bg-white/70 text-sm font-medium text-ink"
          >
            <ImageUp size={18} strokeWidth={2} />
            Choose a photo
          </button>
        </div>
      )}

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
