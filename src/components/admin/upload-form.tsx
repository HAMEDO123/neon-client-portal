"use client";

import { useRef, useState, useTransition } from "react";
import { whileBusy } from "@/lib/busy";
import { tooBig, uploadFailure } from "@/lib/upload-limits";
import { lastReply, reportUploadFailure, watchingReply } from "@/lib/action-reply";
import type { Answer } from "@/lib/refusal";
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
  /**
   * The upload. An action that answers with its refusal (lib/refusal.ts) has it
   * shown as written; one that returns nothing is taken to have worked, and
   * what it throws is read the way a failed upload always was.
   */
  action: (formData: FormData) => Promise<void | Answer>;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  // The save button reads useFormStatus, which only follows form *actions* —
  // so it no longer greys itself out, and a second press during a long
  // upload would send the file twice. This is that guard.
  const inFlight = useRef(false);

  return (
    <form
      ref={form}
      // onSubmit, not `action`. React 19 resets a form's fields when a form
      // action finishes — failed or not — so after an upload went wrong the
      // file picker was empty again ("Please select a file") and the next try
      // had to start over. The browser still checks `required` before this runs.
      onSubmit={(event) => {
        event.preventDefault();
        if (inFlight.current) return;
        const formData = new FormData(event.currentTarget);

        inFlight.current = true;
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
            inFlight.current = false;
            return;
          }

          try {
            // Held against the live refresh, which would otherwise cancel this
            // mid-flight — see lib/busy.ts — and watched, so a failure can say
            // what actually came back — see lib/action-reply.ts.
            const answer = await whileBusy(() => watchingReply(() => action(formData)));
            // Refused, in the action's own words — and the form keeps what was
            // typed, as it does for any other failure.
            if (answer && !answer.ok) {
              setError(answer.error);
              return;
            }
            if (resetOnSuccess) form.current?.reset();
          } catch (cause) {
            if (isNextSignal(cause)) throw cause;
            const message = cause instanceof Error ? cause.message : "";
            const reply = lastReply();
            setError(uploadFailure(files, message, reply));
            reportUploadFailure({
              where: "upload-form",
              files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
              message,
              reply,
            });
          } finally {
            inFlight.current = false;
          }
        });
      }}
      className={cn(className, pending && "opacity-70")}
    >
      {children}

      {pending && <p className="sm:col-span-full text-xs font-medium text-ink/50">Uploading…</p>}

      {error && (
        <p className="sm:col-span-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
