// The phone app's way into everything the website does.
//
// The website's screens are server components reading `lib/*` queries, and its
// buttons are server actions. The app can call neither: it has no session
// cookie, and a server action's id changes with every build. So rather than a
// second hand-written route for each of the ~150 things the studio does — a
// second copy of every rule, drifting from the first — two routes serve them
// all, through registries that name what the app may call:
//
//   GET  /api/mobile/get/<area>/<name>?…   a read  (READS in registry/index.ts)
//   POST /api/mobile/do/<area>/<name>       an action (ACTIONS in registry/index.ts)
//
// An action entry calls the website's own server action — the same function a
// button on the website calls — so its guard, its rules, its notifications and
// its revalidation are the website's. The guards read the session through
// lib/session-token.ts, which accepts the app's bearer token as well as the
// cookie, so nothing had to be loosened for this.
//
// A read entry calls the same `lib` queries a page reads, and **must call the
// same guard that page is behind** (requireAdmin, requireStaff, …) before it
// reads anything. The route itself only refuses a request with no valid
// session at all; which session may read what is the entry's to say, exactly
// as it is the page's on the website.

export class RpcError extends Error {
  constructor(
    message: string,
    readonly status = 400
  ) {
    super(message);
  }
}

/** What an action entry receives: positional arguments, and a form. */
export type ActionInput = {
  /** JSON arguments, in the order the server action takes them. */
  args: unknown[];
  /** The fields (and files) a website form would post, for actions that take FormData. */
  form: FormData;
};

export type ActionEntry = (input: ActionInput) => Promise<unknown>;
export type ReadEntry = (params: URLSearchParams) => Promise<unknown>;

export type ActionRegistry = Record<string, ActionEntry>;
export type ReadRegistry = Record<string, ReadEntry>;

/**
 * A read behind the same guard as the website page it mirrors — the only way
 * a read entry is written (tests/mobile-registry.test.ts checks every one).
 * The guard's answer is handed on, so a read that depends on who is asking
 * (an employee's own requests) takes it from the guard, never from a param.
 *
 *   "team/employees": guarded(requireAdmin, async () => listEmployees()),
 *   "me/requests":    guarded(requireEmployee, async (_params, me) => requestsFor(me.id)),
 */
export function guarded<Who>(
  guard: () => Promise<Who>,
  read: (params: URLSearchParams, who: Who) => Promise<unknown>
): ReadEntry {
  return async (params) => read(params, await guard());
}

/**
 * An action that is not one of the website's own server actions — a `lib`
 * function called directly — behind the guard its website counterpart uses.
 * Entries that call a server action from lib/actions need no wrapper: the
 * action carries its own guard.
 */
export function guardedAction<Who>(
  guard: () => Promise<Who>,
  run: (input: ActionInput, who: Who) => Promise<unknown>
): ActionEntry {
  return async (input) => run(input, await guard());
}

// --- Reading arguments -------------------------------------------------------
//
// Arguments come from a phone, so they are checked the way a form field would
// be: the wrong type is a 400 with a sentence, not a crash deep in Prisma.

export function str(value: unknown, name = "value"): string {
  if (typeof value !== "string" || value.length === 0) throw new RpcError(`${name} is required.`);
  return value;
}

export function optStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function num(value: unknown, name = "value"): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) throw new RpcError(`${name} must be a number.`);
  return parsed;
}

export function optNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function bool(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], name = "value"): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new RpcError(`${name} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

export function strArray(value: unknown, name = "value"): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new RpcError(`${name} must be a list of strings.`);
  }
  return value as string[];
}

/** A query parameter a read cannot do without. */
export function param(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (!value) throw new RpcError(`${key} is required.`);
  return value;
}

export function optParam(params: URLSearchParams, key: string): string | null {
  const value = params.get(key);
  return value ? value : null;
}

// --- Answering ---------------------------------------------------------------

/** JSON the way the app reads it: Dates as ISO strings, BigInt as a number. */
export function json(value: unknown, status = 200): Response {
  const body = JSON.stringify(value === undefined ? null : value, (_key, item) =>
    typeof item === "bigint" ? Number(item) : item
  );
  // no-store: the app must always see the server's current answer, never a
  // copy kept by the phone or anything in between.
  return new Response(body, { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/**
 * For an action that answers with its refusal instead of throwing it
 * (lib/refusal.ts). The website needs the answer — a thrown sentence never
 * reaches a production page — and the app needs what it has always had: an
 * `{ error }` with a 400. So the answer is turned back into the throw here, and
 * a success hands back nothing, exactly as the action did when it returned
 * nothing.
 */
export function heard(answer: { ok: true } | { ok: false; error: string }): void {
  if (!answer.ok) throw new RpcError(answer.error);
}

type Digested = { digest?: unknown };

/**
 * What a thrown error means to the app.
 *
 * - `redirect()` inside a server action is how the website moves on after a
 *   save ("created — now go to the project"). For the app that is success, and
 *   the path is passed back so it can do the same.
 * - `notFound()` is a 404.
 * - "Unauthorized" is what every guard throws: a 403 when the session itself is
 *   valid (the registry routes), a 401 — signed out — otherwise.
 * - Any other Error an action throws is a sentence written for a person
 *   ("This employee already has 3 warnings…"), so it is shown as it is.
 * - Anything else is logged and answered without detail.
 */
export function answerError(error: unknown, signedIn = false): Response {
  const digest = typeof (error as Digested)?.digest === "string" ? String((error as Digested).digest) : "";

  if (digest.startsWith("NEXT_REDIRECT")) {
    const parts = digest.split(";");
    return json({ ok: true, result: null, redirect: parts.slice(2, -2).join(";") || null });
  }
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK")) {
    const status = Number(digest.split(";")[1]) || 404;
    return json({ error: status === 404 ? "Not found." : "Not allowed." }, status);
  }
  if (error instanceof RpcError) return json({ error: error.message }, error.status);
  // A guard's refusal. On the two registry routes the session has already been
  // found valid, so this is "not yours to do" (403) — never "signed out" (401),
  // which the app answers by signing the person out.
  if (error instanceof Error && error.message === "Unauthorized") {
    return signedIn ? json({ error: "That is not available to you." }, 403) : json({ error: "Unauthorized." }, 401);
  }

  // Prisma's "no row to update/delete" is somebody acting on something gone.
  if ((error as { code?: unknown })?.code === "P2025") return json({ error: "That no longer exists." }, 404);

  if (error instanceof Error && error.message && !error.message.includes("\n") && error.message.length < 400) {
    return json({ error: error.message }, 400);
  }

  console.error("[mobile rpc]", error);
  return json({ error: "Something went wrong. Try again." }, 500);
}
