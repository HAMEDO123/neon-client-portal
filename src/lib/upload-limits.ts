// How big a file may be, and where that number comes from.
//
// There are two ceilings and neither of them used to say so. A file past
// either one produced **"An unexpected response was received from the server"**
// — the browser getting an error page where it expected an answer — with
// nothing in the server's log, because nothing of ours ever ran.
//
//   **Cloudflare stops at 100 MB** and answers 413 itself. Measured on
//   2026-10-03: 95 MB reached the tunnel, 100 MB and 105 MB did not. It is the
//   free plan's limit and no setting here changes it.
//
//   **Next stops at `serverActions.bodySizeLimit`**, which is 90 MB in
//   next.config.ts. Past that the request dies between the tunnel and the app
//   and comes back as a 502.
//
// So the real limit is the smaller of the two, less room for what multipart
// adds around the file — boundaries, part headers, the other fields — which
// Next's own guide puts at 10–20 KB and which is worth being generous about
// rather than exact.
//
// Pure, and checked in the browser before anything is sent, so an oversized
// file is a sentence somebody can act on instead of a dead request.

import { describeReply, type ActionReply } from "./action-reply";
import { isOpaqueFailure } from "./refusal";

/** Cloudflare's own ceiling on the free plan. Not ours to raise. */
export const CLOUDFLARE_LIMIT_BYTES = 100 * 1024 * 1024;

/** What `serverActions.bodySizeLimit` in next.config.ts is set to. */
export const BODY_LIMIT_BYTES = 90 * 1024 * 1024;

/** The largest single file worth offering, with room for the multipart wrapper. */
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

/** "80 MB", "2.4 MB", "640 KB" — for a sentence, not a table. */
export function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024);
    return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * What is wrong with these files, or null.
 *
 * Every file is weighed, and the total too: the forms that post one file at a
 * time are safe either way, but the gallery's own uploader sends several in one
 * request and the limit applies to the whole body.
 */
export function tooBig(files: File[], max = MAX_UPLOAD_BYTES): string | null {
  const over = files.find((file) => file.size > max);
  if (over) {
    return `${over.name} is ${sizeLabel(over.size)}. The largest file that can be uploaded is ${sizeLabel(max)}.`;
  }

  const total = files.reduce((sum, file) => sum + file.size, 0);
  if (files.length > 1 && total > max) {
    return `Those ${files.length} files come to ${sizeLabel(total)} together. ${sizeLabel(max)} is the most that can go in one upload — add them a few at a time.`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// When the failure itself says nothing
//
// Two different things reach the browser as a sentence nobody can act on, and
// they are worth telling apart from a real refusal:
//
//   **Cloudflare's 413.** Measured on 2026-10-03 against the live site: 75 MB
//   uploaded fine, 95 MB reached the app and was refused by our own rule, and
//   105 MB came back `413 Payload Too Large` as an **HTML page** from
//   Cloudflare. React sees a reply that is not `text/x-component` and says
//   *"An unexpected response was received from the server."* Nothing of ours
//   ran, so the server log is empty — which is the whole difficulty: the one
//   failure with no evidence anywhere is the one with a cause we cannot fix.
//
//   **Next redacting a server action's error in production.** A thrown message
//   never reaches the browser: the reply carries a digest and nothing else, and
//   React builds an error whose text is a paragraph about omitted details. So
//   "File is too large" and "That file type is not supported" both arrive as
//   the same unreadable thing.
//
// In either case the browser still knows what it tried to send, and that is
// the fact worth putting on screen. An unknown action is deliberately NOT in
// this list — Next answers that one `text/plain` with "Server action not
// found.", which React shows verbatim and which means something quite
// different.

// The list itself lives in lib/refusal.ts, beside the other half of the same
// problem (a sentence an action wanted to say, and could not). It gained
// "Minified React error" there: that, not the long sentence about production
// builds, is what a redacted refusal actually reads as on a production page.
export { isOpaqueFailure };

/**
 * What to show when an upload fails: the message if it says something, and
 * otherwise what we sent, what came back, and what to do about it.
 *
 * `reply` is what the browser itself saw (lib/action-reply.ts). It is what
 * separates the cases the message cannot: our own reply means NEON got the file
 * and refused it with the reason hidden; anybody else's means it never arrived.
 * The size is named even though the form checked it already — a page left open
 * since before that check existed does not have it.
 */
export function uploadFailure(
  files: { name: string; size: number }[],
  message: string,
  reply: ActionReply | null = null
): string {
  if (message && !isOpaqueFailure(message)) return message;

  const sent = files.filter((file) => file.size > 0);
  const total = sent.reduce((sum, file) => sum + file.size, 0);

  const what =
    sent.length === 0
      ? "That upload"
      : sent.length === 1
        ? `${sent[0].name} (${sizeLabel(sent[0].size)})`
        : `Those ${sent.length} files (${sizeLabel(total)} together)`;

  const seen = describeReply(reply);
  const evidence = seen ? ` What your browser got back: ${seen}` : "";

  // Ours: the file arrived, and Next kept the reason off the page.
  if (reply && reply.status > 0 && (reply.contentType ?? "").startsWith("text/x-component")) {
    return `${what} reached NEON and was refused, but the reason was hidden from this page. It is in the server's log.${evidence}`;
  }

  if (total > MAX_UPLOAD_BYTES) {
    return `${what} never reached NEON — it is over the ${sizeLabel(MAX_UPLOAD_BYTES)} limit, and is refused before it arrives. Send a smaller file.${evidence}`;
  }

  if (seen) return `${what} never reached NEON.${evidence}`;

  return `${what} never reached NEON, and the server was not told why. Reload the page and try once more; if it fails again the file may be too large for the connection — ${sizeLabel(MAX_UPLOAD_BYTES)} is the most that can be sent.`;
}
