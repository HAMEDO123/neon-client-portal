import Anthropic from "@anthropic-ai/sdk";

// One place that knows whether AI features are switched on. Everything that
// uses Claude asks here first and degrades gracefully when no key is set —
// the portal must keep working without it.

export const ASSISTANT_MODEL = "claude-opus-5";

let cached: Anthropic | null = null;

export function isAiConfigured() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

export function getAiClient(): Anthropic | null {
  if (!isAiConfigured()) return null;
  // The SDK reads ANTHROPIC_API_KEY from the environment itself.
  cached ??= new Anthropic();
  return cached;
}

/** Turns an SDK error into something worth showing a person. */
export function describeAiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "The AI key was rejected. Check ANTHROPIC_API_KEY.";
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "The assistant is rate limited right now — try again in a moment.";
  }
  if (error instanceof Anthropic.APIError) {
    return `The assistant could not answer (API error ${error.status}).`;
  }
  return error instanceof Error ? error.message : "The assistant could not answer.";
}
