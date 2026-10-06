import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Refusal, answering, isOpaqueFailure, shownError } from "../src/lib/refusal";
import { RpcError, heard } from "../src/lib/mobile/rpc";

// A sentence an action wants to say, and whether it reaches the person.
//
// In production a thrown message never leaves the server, so the sheet for
// ending a site visit showed "Minified React error #441" where "A visit is
// answered for by whoever went." was meant. In development the same throw reads
// perfectly — which is why nothing we run had ever noticed, and why these are
// pinned.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

describe("an action that answers", () => {
  it("hands back its refusal as data", async () => {
    const answer = await answering(async () => {
      throw new Refusal("Write what came of the visit.");
    });
    assert.deepEqual(answer, { ok: false, error: "Write what came of the visit." });
  });

  it("says so when it went through", async () => {
    assert.deepEqual(await answering(async () => "anything"), { ok: true });
  });

  // A database that did not answer is not a sentence for somebody on a site
  // visit. It stays a fault: logged with its stack, and never shown as detail.
  it("leaves a fault a fault", async () => {
    await assert.rejects(
      answering(async () => {
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      }),
      /ECONNREFUSED/
    );
  });

  // The phone app catches what an action throws and shows the sentence. A
  // Refusal has to read to it exactly as the plain Error it replaced.
  it("is still an Error with its sentence, for whoever catches one", () => {
    const refusal = new Refusal("That visit has already been answered for.");
    assert.ok(refusal instanceof Error);
    assert.equal(refusal.message, "That visit has already been answered for.");
  });
});

describe("what a caught error may be shown as", () => {
  const REACT = "Minified React error #441; visit https://react.dev/errors/441 for the full message or use the non-minified dev environment for full errors and additional helpful warnings.";
  const REDACTED =
    "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details.";

  // Exactly what was on the owner's screen.
  it("is never React's stand-in for a message it was not given", () => {
    assert.equal(isOpaqueFailure(REACT), true);
    assert.equal(shownError(new Error(REACT), "That did not save. Try again."), "That did not save. Try again.");
    assert.equal(shownError(new Error(REDACTED), "That did not save."), "That did not save.");
    assert.equal(shownError(new Error("Failed to fetch"), "Could not reach NEON."), "Could not reach NEON.");
  });

  it("is the error's own words when it has some", () => {
    assert.equal(shownError(new Error("Notifications are blocked for this site."), "x"), "Notifications are blocked for this site.");
    // A page from another build says this, and it means something different.
    assert.equal(shownError(new Error("Server action not found."), "x"), "Server action not found.");
  });

  it("is the fallback for anything that is not an error at all", () => {
    assert.equal(shownError(undefined, "That did not save."), "That did not save.");
    assert.equal(shownError("a string", "That did not save."), "That did not save.");
    assert.equal(shownError(new Error("   "), "That did not save."), "That did not save.");
  });
});

describe("the phone app is told the way it always was", () => {
  it("gets the refusal as the error it used to catch", () => {
    assert.throws(
      () => heard({ ok: false, error: "Write what came of the visit." }),
      (error: unknown) => error instanceof RpcError && error.message === "Write what came of the visit." && error.status === 400
    );
  });

  it("gets nothing back for a success, as when the action returned nothing", () => {
    assert.equal(heard({ ok: true }), undefined);
  });

  // An answer the registry passed straight through would be a 200 with
  // `{ ok: false }` in it, which the app reads as "it worked".
  it("is how every answering action reaches the registry", () => {
    const ops = read("src", "lib", "mobile", "registry", "ops.ts");
    for (const action of ["scheduleSiteVisit", "updateSiteVisit", "reportSiteVisit", "deleteSiteVisit"]) {
      assert.match(ops, new RegExp(`heard\\(await ${action}\\(`), action);
    }
    assert.match(read("src", "lib", "mobile", "registry", "me.ts"), /heard\(await submitReceipt\(/);
  });
});

describe("the site-visit diary says what it means", () => {
  const actions = read("src", "lib", "actions", "site-visit-actions.ts");

  it("refuses with sentences that can arrive, in every export", () => {
    // A plain throw here is a sentence nobody will ever read.
    assert.equal(actions.includes("throw new Error("), false, "a plain throw is back in site-visit-actions.ts");
    const exports = actions.match(/^export async function \w+/gm) ?? [];
    const answered = actions.match(/^export async function \w+\([^)]*\): Promise<Answer> \{\n  return answering\(/gm) ?? [];
    assert.ok(exports.length >= 7, "site-visit-actions.ts has lost exports — has it moved?");
    assert.equal(answered.length, exports.length, "every visit action answers");
  });

  // One browser can hold both sessions, and the owner's does. Every other guard
  // may ask for the manager first; this one must not — the manager answers for
  // nobody's visit, so "the manager's session wins" refused somebody finishing
  // their own.
  it("asks who is going before it asks whether the manager is here", () => {
    const guard = read("src", "lib", "admin-guard.ts");
    const body = guard.slice(guard.indexOf("export async function requireSiteVisitor"));
    const visitor = body.indexOf("getSessionEmployee()");
    const manager = body.indexOf("hasAdminSession()");
    assert.ok(visitor > 0 && manager > 0);
    assert.ok(visitor < manager, "requireSiteVisitor asks for the manager's session first again");
  });

  // React empties a form whenever a form *action* finishes, refused or not. An
  // account of a visit written on site was wiped the moment sending it failed.
  it("keeps what somebody wrote when it is turned away", () => {
    for (const file of [
      ["src", "components", "tasks", "site-visits.tsx"],
      ["src", "components", "admin", "new-site-visit.tsx"],
    ]) {
      const source = read(...file);
      assert.equal(/<form\s+(?:\/\/[^\n]*\n\s*)*action=\{/.test(source), false, `${file.at(-1)} submits through a form action again`);
      assert.match(source, /onSubmit=\{\(event\) => \{\n\s+event\.preventDefault\(\);/, file.at(-1));
    }
  });
});
