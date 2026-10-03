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
