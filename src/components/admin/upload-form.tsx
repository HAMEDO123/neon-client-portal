"use client";

import { useRef, useState, useTransition } from "react";
import { whileBusy } from "@/lib/busy";
import { tooBig, uploadFailure } from "@/lib/upload-limits";
import { cn } from "@/lib/utils";

// A form that carries a file, and says what went wrong.
//
// Every upload form on the project tabs was a plain server-action form, so
// anything the action threw — an unsupported type, a file over the limit, a
// camera photo the browser could not name — reached nobody. Next caught it at
// the error boundary and drew **"This page couldn't load"**, with the real
// sentence only in the server's log, which the person uploading cannot read.
//
// So the message is shown where the upload was attempted, and the form keeps
// what was typed in it: an error that loses a filled-in form is an error that
// costs the work twice.

/** Next's own control flow, which must never be caught and drawn as a failure. */
function isNextSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest === "NEXT_NOT_FOUND");
}

export function UploadForm({
  action,
  children,
  className,
  /** Cleared on success. Off where the page redraws with the new row anyway. */
  resetOnSuccess = true,
}: {
  action: (formData: FormData) => Promise<void>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={form}
      action={(formData) =>
        startTransition(async () => {
          setError(null);

          // Weighed here, before a byte is sent. Past the limit the upload does
          // not fail with a message — it dies between Cloudflare and the app
          // and comes back as a reply the browser cannot read, which is the
          // least useful thing a person can be told. See lib/upload-limits.ts.
          const files = [...formData.values()].filter((value): value is File => value instanceof File);
          const refusal = tooBig(files.filter((file) => file.size > 0));
          if (refusal) {
            setError(refusal);
            return;
          }

          try {
            // Held against the live refresh, which would otherwise cancel this
            // mid-flight — see lib/busy.ts.
            await whileBusy(() => action(formData));
            if (resetOnSuccess) form.current?.reset();
          } catch (cause) {
            if (isNextSignal(cause)) throw cause;
            // Neither of the two ways this fails carries a message worth
            // reading — Cloudflare's own 413 never reaches our code, and Next
            // strips a thrown message in production — so what the browser
            // knows about the file is said instead. See lib/upload-limits.ts.
            setError(uploadFailure(files, cause instanceof Error ? cause.message : ""));
          }
        })
      }
      className={cn(className, pending && "opacity-70")}
    >
      {children}

      {error && (
        <p className="sm:col-span-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
