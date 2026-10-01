import { prisma } from "@/lib/db";
import { generateAccessCode, normaliseCode } from "@/lib/client-codes";

// Turning a code a client typed into the project it belongs to.
//
// Deliberately not a `"use server"` module: every export of one of those is
// callable over the network, and this one answers "which project does this
// string open" — exactly the question an attacker would like a public endpoint
// for. The route above it owns the rate limit.

/** How many wrong codes one address may try, and over how long. */
const ATTEMPT_LIMIT = 10;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Wrong attempts per caller, in this process's memory.
 *
 * In memory on purpose, and worth being honest about what that does and does
 * not do. It survives nothing — a restart, a second container — so it is not a
 * defence against somebody determined. What it is for is the shape of attack a
 * short code invites: a script working through codes from one address, which it
 * stops dead within ten tries. A code is 32^8, so even unlimited guessing at
 * one a second is a job of thousands of years; the limit is here so the attempt
 * is not free, and so the studio's log is not filled by it.
 *
 * A table would make it durable and give something to chart. That is worth
 * doing when there is any sign of it being needed, and not before.
 */
const attempts = new Map<string, { count: number; firstAt: number }>();

function tooMany(caller: string, now: number): boolean {
  const seen = attempts.get(caller);
  if (!seen) return false;
  if (now - seen.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.delete(caller);
    return false;
  }
  return seen.count >= ATTEMPT_LIMIT;
}

function recordMiss(caller: string, now: number) {
  const seen = attempts.get(caller);
  if (!seen || now - seen.firstAt > ATTEMPT_WINDOW_MS) {
    attempts.set(caller, { count: 1, firstAt: now });
    return;
  }
  seen.count += 1;

  // Nothing sweeps this, so it is swept here: without it a long-running
  // process grows a row per address that ever mistyped a code.
  if (attempts.size > 5000) {
    for (const [key, value] of attempts) {
      if (now - value.firstAt > ATTEMPT_WINDOW_MS) attempts.delete(key);
    }
  }
}

export type CodeResult =
  | { ok: true; token: string; projectId: string; name: string; clientName: string }
  /** Nothing opens with that code — a wrong code, or one that has been replaced. */
  | { ok: false; reason: "unknown" }
  /** The code is right but the project is not open to the client yet. */
  | { ok: false; reason: "draft" | "archived" }
  | { ok: false; reason: "too-many" };

/**
 * The project a typed code opens.
 *
 * The same three answers `/p/[token]` gives, for the same reasons: a project
 * that is a draft or archived is not a wrong code and must not be reported as
 * one, or a client rings the studio to say their code is broken when it is
 * their project that is not ready.
 */
export async function projectForCode(input: string, caller: string, now = Date.now()): Promise<CodeResult> {
  if (tooMany(caller, now)) return { ok: false, reason: "too-many" };

  const code = normaliseCode(input);
  if (!code) {
    // A string that cannot be a code at all still counts as an attempt: it is
    // what a script trying `aaaaaaaa`, `aaaaaaab` looks like.
    recordMiss(caller, now);
    return { ok: false, reason: "unknown" };
  }

  const project = await prisma.project.findUnique({
    where: { accessCode: code },
    select: { id: true, token: true, name: true, clientName: true, publishState: true },
  });

  if (!project) {
    recordMiss(caller, now);
    return { ok: false, reason: "unknown" };
  }

  // A right code is not an attempt, whatever state the project is in.
  attempts.delete(caller);

  if (project.publishState === "ARCHIVED") return { ok: false, reason: "archived" };
  if (project.publishState !== "PUBLISHED") return { ok: false, reason: "draft" };

  return {
    ok: true,
    token: project.token,
    projectId: project.id,
    name: project.name,
    clientName: project.clientName,
  };
}

/**
 * The project's code, made now if it has never had one.
 *
 * Projects existed before codes did, so the column is nullable and this is what
 * fills it: the manager's own project page calls it, so the first look at any
 * older project gives it a code to hand out. A collision is a one-in-a-million-
 * million event that would otherwise surface to the manager as a crash, so it
 * is retried rather than trusted.
 */
export async function ensureAccessCode(projectId: string): Promise<string | null> {
  const existing = await prisma.project.findUnique({
    where: { id: projectId },
    select: { accessCode: true },
  });
  if (!existing) return null;
  if (existing.accessCode) return existing.accessCode;

  return claimCode(projectId);
}

/**
 * A new code for a project, which stops the old one working.
 *
 * The mirror of regenerating the link: a client who should no longer be able to
 * open the project is shut out by giving it one of these.
 */
export async function regenerateAccessCode(projectId: string): Promise<string | null> {
  return claimCode(projectId);
}

async function claimCode(projectId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const accessCode = generateAccessCode();
    try {
      const saved = await prisma.project.update({
        where: { id: projectId },
        data: { accessCode },
        select: { accessCode: true },
      });
      return saved.accessCode;
    } catch (error) {
      // P2002 is the unique index refusing a code already in use. Anything
      // else — a project that has been deleted, a database that is down — is
      // not ours to swallow.
      const code = (error as { code?: string } | null)?.code;
      if (code !== "P2002") throw error;
    }
  }
  throw new Error("Could not make a new code for this project. Please try again.");
}
