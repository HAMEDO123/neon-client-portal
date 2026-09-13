import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A guard that goes missing is invisible to everything else we run.
//
// It typechecks. It lints. It builds. Every other test passes. The only thing
// that notices is somebody calling the action, and by then it has happened. So
// the check that used to be a paragraph in the README is a test instead.
//
// Deliberately narrow: the files below are the ones whose exports have actually
// been read and accounted for, one by one. A sweep of every action file would
// need an opinion about employee-side and login actions too, and a test that
// guesses is worse than one that is honest about its scope.

const DIR = join(process.cwd(), "src", "lib", "actions");

/** How many of each file's exports must carry an admin check. */
const EXPECTED: Record<string, number> = {
  "project-actions.ts": 7,
  "gallery-actions.ts": 4,
  "drawing-actions.ts": 4,
  "document-actions.ts": 2,
  "boq-actions.ts": 2,
  "pricing-actions.ts": 2,
  "material-actions.ts": 2,
  "furniture-actions.ts": 2,
  "hotspot-actions.ts": 2,
  "analytics-actions.ts": 1,
  "admin-alert-actions.ts": 1,
  "push-test-actions.ts": 1,
  // Two halves each: the manager's actions are guarded, the client's is not.
  "approval-actions.ts": 2,
  "comment-actions.ts": 2,
};

/**
 * Actions that are open on purpose, with the reason.
 *
 * A client has no login: the project link is the credential. Each of these is
 * scoped by token inside its own `where`, so a guessed id without the matching
 * link finds nothing. Adding a name here should take an argument, not a shrug.
 */
const DELIBERATELY_OPEN: Record<string, string> = {
  respondToApproval: "the client responds through their project link, not a session",
  createComment: "the client comments through their project link, not a session",
};

const GUARD = "await requireAdmin();";

function read(file: string): string {
  return readFileSync(join(DIR, file), "utf8");
}

/** Each exported action, as its name and its body. */
function exportedActions(source: string): { name: string; body: string }[] {
  return source
    .split(/\nexport async function /)
    .slice(1)
    .map((chunk) => ({ name: chunk.slice(0, chunk.search(/[\s(]/)), body: chunk }));
}

describe("every admin action checks the session itself", () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file} guards ${expected} of its exports`, () => {
      const source = read(file);
      const actions = exportedActions(source);

      const guarded = actions.filter((action) => action.body.includes(GUARD));
      assert.equal(
        guarded.length,
        expected,
        `${file}: expected ${expected} guarded exports, found ${guarded.length} of ${actions.length}`
      );

      // Anything left open must be open on purpose and say why.
      for (const action of actions) {
        if (action.body.includes(GUARD)) continue;
        assert.ok(
          DELIBERATELY_OPEN[action.name],
          `${file}: ${action.name} has no admin check and is not in the deliberately-open list`
        );
      }
    });
  }

  it("keeps the client's own actions open, because a client has no session", () => {
    // The opposite failure: somebody "fixes" these and the client page dies
    // with Unauthorized on every comment and every approval.
    for (const [name, reason] of Object.entries(DELIBERATELY_OPEN)) {
      const file = name === "respondToApproval" ? "approval-actions.ts" : "comment-actions.ts";
      const action = exportedActions(read(file)).find((candidate) => candidate.name === name);

      assert.ok(action, `${name} has gone from ${file}`);
      assert.ok(!action.body.includes(GUARD), `${name} must stay open: ${reason}`);
      // Open, but not unprotected: the token is what scopes it.
      assert.ok(action.body.includes("token"), `${name} must still be scoped by the project token`);
    }
  });

  it("keeps the guard itself out of a 'use server' module", () => {
    // Every export of a "use server" file is a public endpoint. A guard that can
    // be called over the network is not a guard.
    //
    // The check is for the directive on a line of its own, not for the words.
    // The guard file explains in prose why it is not a "use server" module, and
    // a substring search reads that explanation as the very thing it warns
    // against — which is how a check ends up failing something that is right.
    const guard = readFileSync(join(process.cwd(), "src", "lib", "admin-guard.ts"), "utf8");
    const directives = guard
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line === '"use server";' || line === "'use server';");

    assert.deepEqual(directives, [], "admin-guard.ts must not be a 'use server' module");
    assert.ok(guard.includes("export async function requireAdmin"));
  });
});
