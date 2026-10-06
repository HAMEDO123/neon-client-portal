import { whileBusy } from "@/lib/busy";
import { shownError, type Answer } from "@/lib/refusal";

// Calling an action that answers (lib/refusal.ts), from a screen.
//
// One line at the call site, and it settles the three things each screen was
// getting wrong separately:
//
//   - **The sentence arrives.** The action's refusal is data, so it is shown as
//     written; nothing is caught and re-read off an Error.
//   - **A fault is not shown as React's stand-in for one.** If the action
//     itself throws, the screen says its own fallback — never "Minified React
//     error #441".
//   - **The live refresh does not cancel it.** Ending a visit sends the client
//     a WhatsApp message and takes a few seconds; a `router.refresh()` landing
//     in the middle of a server action kills the request (see lib/busy.ts).
//
// Resolves to the sentence to show, or null when it went through.

export async function refusalOf(run: () => Promise<Answer>, fallback: string): Promise<string | null> {
  try {
    const answer = await whileBusy(run);
    return answer.ok ? null : answer.error;
  } catch (cause) {
    return shownError(cause, fallback);
  }
}
