// A sentence written for the person, that has to reach them.
//
// **In production a thrown message never leaves the server.** Next sends the
// browser `1:E{"digest":"…"}` and nothing else, and React builds its own error
// from that — so a server action that throws "A visit is answered for by
// whoever went." puts **"Minified React error #441"** on the screen, which is
// what the site-visit sheet showed the day this was written. Every careful
// refusal in an action was invisible in exactly the place it was written for;
// in development the same throw reads perfectly, which is why it keeps being
// written.
//
// So an action that may refuse *answers* instead: `{ ok: false, error }`, which
// is ordinary data and arrives as it is. The split is deliberate:
//
//   - `Refusal` is a sentence for the reader — "write what came of the visit".
//     `answering` turns it into an answer.
//   - anything else thrown is a fault — a database that did not answer, a bug —
//     and stays thrown: it is logged with its stack (src/instrumentation.ts)
//     and the page shows its own fallback, never a stack's worth of detail.
//
// A plain module, not "use server": every export of one of those is callable
// over the network.
//
// `Refusal` is still an `Error`, so the phone API, which catches what an action
// throws and passes the sentence on (`answerError` in lib/mobile/rpc.ts), reads
// one exactly as it read the plain Error it replaces.

export class Refusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "Refusal";
  }
}

export type Answer = { ok: true } | { ok: false; error: string };

/** Runs an action's work, and answers with its refusal rather than throwing it. */
export async function answering(run: () => Promise<unknown>): Promise<Answer> {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    if (error instanceof Refusal) return { ok: false, error: error.message };
    throw error;
  }
}

/** What React and the network say when they have nothing to say. */
const OPAQUE = [
  "minified react error",
  "unexpected response was received from the server",
  "error occurred in the server components render",
  "an error occurred in the server components",
  "omitted in production builds",
  "failed to fetch",
  "load failed",
  "networkerror",
];

/** Whether this message is one of the ones that tells the reader nothing. */
export function isOpaqueFailure(message: string): boolean {
  const text = message.toLowerCase();
  return OPAQUE.some((phrase) => text.includes(phrase));
}

/**
 * What a caught error may be shown as: its own words when it has any, and the
 * screen's fallback otherwise. Never React's stand-in for a message it was not
 * given — "Minified React error #441" tells somebody on a site visit nothing,
 * and sends whoever they forward it to looking for a bug in React.
 */
export function shownError(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message.trim() : "";
  return message && !isOpaqueFailure(message) ? message : fallback;
}
