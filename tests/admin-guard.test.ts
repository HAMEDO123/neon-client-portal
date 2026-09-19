import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// A guard that goes missing is invisible to everything else we run.
//
// It typechecks. It lints. It builds. Every other test passes. The only thing
// that notices is somebody calling the action, and by then it has happened. So
// the check that used to be a paragraph in the README is a test instead.
//
// There are two guards now, and which one an action carries is the whole point:
//
//   - `requireAdmin` is the manager alone: payroll, employees, settings, the
//     week board, automation, warnings — and creating or deleting a project.
//   - `requireStaff` is the manager **or** somebody on the team, for the
//     contents of a project. The studio decided the team works a project the
//     way the manager does, including removing a file and not only adding one.
//
// The dangerous direction is one-way: an action that quietly moves from the
// first to the second hands the whole team something meant for the manager.
// Counting is what catches it, because nothing else can.
//
// Deliberately narrow: the files below are the ones whose exports have actually
// been read and accounted for, one by one. A sweep of every action file would
// need an opinion about employee-side and login actions too, and a test that
// guesses is worse than one that is honest about its scope.

const DIR = join(process.cwd(), "src", "lib", "actions");

const ADMIN = "await requireAdmin();";
const STAFF = "await requireStaff();";

/** How many of each file's exports carry each check. */
const EXPECTED: Record<string, { admin: number; staff: number }> = {
  // A project's own contents: the team works these.
  "gallery-actions.ts": { admin: 0, staff: 4 },
  "drawing-actions.ts": { admin: 0, staff: 4 },
  "document-actions.ts": { admin: 0, staff: 2 },
  "boq-actions.ts": { admin: 0, staff: 2 },
  "pricing-actions.ts": { admin: 0, staff: 2 },
  "material-actions.ts": { admin: 0, staff: 2 },
  "furniture-actions.ts": { admin: 0, staff: 2 },
  "hotspot-actions.ts": { admin: 0, staff: 2 },
  // Two halves each: the studio's actions are guarded, the client's is not.
  "approval-actions.ts": { admin: 0, staff: 2 },
  "comment-actions.ts": { admin: 0, staff: 2 },
  // Mixed on purpose — see NAMED below, which is the part that matters.
  "project-actions.ts": { admin: 2, staff: 5 },
  "whatsapp-actions.ts": { admin: 6, staff: 1 },
  // The manager's alone.
  "analytics-actions.ts": { admin: 1, staff: 0 },
  "admin-alert-actions.ts": { admin: 1, staff: 0 },
  "push-test-actions.ts": { admin: 1, staff: 0 },
};

/**
 * The exports where the *particular* guard is the decision, not the count.
 *
 * A count keeps the totals honest; these keep the right ones on the right side
 * of the line. Every one of them would be a quiet disaster the other way.
 */
const NAMED: Record<string, { file: string; guard: string; why: string }> = {
  deleteProject: {
    file: "project-actions.ts",
    guard: ADMIN,
    why: "it takes the project and every file it holds out of storage for good",
  },
  createProject: {
    file: "project-actions.ts",
    guard: ADMIN,
    why: "it is not on the project screen, so nobody asked for it to be shared",
  },
  setPublishState: {
    file: "project-actions.ts",
    guard: STAFF,
    why: "publishing is on the project screen the team was given",
  },
  regenerateProjectLink: {
    file: "project-actions.ts",
    guard: STAFF,
    why: "it is on the project screen the team was given",
  },
  sendProjectWhatsApp: {
    file: "whatsapp-actions.ts",
    guard: STAFF,
    why: "Send to Client is on the project screen the team was given",
  },
  unlinkWhatsApp: {
    file: "whatsapp-actions.ts",
    guard: ADMIN,
    why: "it would take the whole platform's messaging down with it",
  },
  saveTimezone: {
    file: "whatsapp-actions.ts",
    guard: ADMIN,
    why: "it moves every day, deadline and payslip in the platform",
  },
  sendTestWhatsApp: {
    file: "whatsapp-actions.ts",
    guard: ADMIN,
    why: "free text to any number at all, which is not a project action",
  },
};

/**
 * Files where `requireStaff` belongs. Anything else reaching for it is the
 * regression this whole test exists for: the manager's own tools handed to the
 * team by somebody who grabbed the nearer guard.
 */
const MAY_USE_STAFF = new Set(Object.keys(EXPECTED));

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

describe("every action checks the session itself", () => {
  for (const [file, expected] of Object.entries(EXPECTED)) {
    it(`${file} guards ${expected.admin} as the manager and ${expected.staff} as the studio`, () => {
      const actions = exportedActions(read(file));

      const admin = actions.filter((action) => action.body.includes(ADMIN));
      const staff = actions.filter((action) => action.body.includes(STAFF));

      assert.equal(admin.length, expected.admin, `${file}: manager-only exports`);
      assert.equal(staff.length, expected.staff, `${file}: studio-wide exports`);

      // Anything left open must be open on purpose and say why.
      for (const action of actions) {
        if (action.body.includes(ADMIN) || action.body.includes(STAFF)) continue;
        assert.ok(
          DELIBERATELY_OPEN[action.name],
          `${file}: ${action.name} has no session check and is not in the deliberately-open list`
        );
      }
    });
  }

  it("keeps the particular exports on the side of the line they were put on", () => {
    for (const [name, { file, guard, why }] of Object.entries(NAMED)) {
      const action = exportedActions(read(file)).find((candidate) => candidate.name === name);

      assert.ok(action, `${name} has gone from ${file}`);
      assert.ok(action.body.includes(guard), `${name} must carry ${guard.trim()} — ${why}`);
    }
  });

  it("keeps the client's own actions open, because a client has no session", () => {
    // The opposite failure: somebody "fixes" these and the client page dies
    // with Unauthorized on every comment and every approval.
    for (const [name, reason] of Object.entries(DELIBERATELY_OPEN)) {
      const file = name === "respondToApproval" ? "approval-actions.ts" : "comment-actions.ts";
      const action = exportedActions(read(file)).find((candidate) => candidate.name === name);

      assert.ok(action, `${name} has gone from ${file}`);
      assert.ok(!action.body.includes(ADMIN) && !action.body.includes(STAFF), `${name} must stay open: ${reason}`);
      // Open, but not unprotected: the token is what scopes it.
      assert.ok(action.body.includes("token"), `${name} must still be scoped by the project token`);
    }
  });

  it("keeps the guards themselves out of a 'use server' module", () => {
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
    assert.ok(guard.includes("export async function requireStaff"));
  });
});

describe("one definition of each check, not twenty-five", () => {
  const files = readdirSync(DIR).filter((name) => name.endsWith("-actions.ts"));

  it("has no action file writing its own", () => {
    // Every one of these used to carry an identical five-line copy. They were
    // all correct — that is the point. A security primitive does not drift
    // because somebody is careless; it drifts because there are twenty-five
    // chances for one of them to be edited and the rest not.
    const local = files.filter((file) => /^async function require(Admin|Staff)/m.test(read(file)));

    assert.deepEqual(local, [], `these define their own guard instead of importing lib/admin-guard.ts: ${local.join(", ")}`);
  });

  it("keeps the raw session primitives to the two files that issue sessions", () => {
    // Reading the cookie directly anywhere else is a guard being written a
    // second time, whatever it is called.
    const touching = files.filter((file) => read(file).includes("SESSION_COOKIE_NAME")).sort();

    assert.deepEqual(touching, ["auth-actions.ts", "employee-auth-actions.ts"]);
  });

  it("lets the studio-wide guard nowhere near the manager's own tools", () => {
    // The one regression this change made possible, and the one nothing else
    // would catch: payroll, employees, settings, the week board, automation and
    // warnings are the manager's. An action there reaching for the nearer guard
    // hands the whole team something that was never theirs, and it would
    // typecheck, lint, build and pass every other test on the way through.
    const reaching = files.filter((file) => !MAY_USE_STAFF.has(file) && read(file).includes("requireStaff")).sort();

    assert.deepEqual(reaching, [], `these are the manager's alone and must not use requireStaff: ${reaching.join(", ")}`);
  });

  it("holds the employee's own project actions to the same standard", () => {
    // A different guard, but the identical failure: an exported action with no
    // session check at all typechecks, lints, builds, and passes every other
    // test. These put drawings and photos straight onto a client's page, so an
    // unguarded one would be reachable by anybody who knew the endpoint.
    const unguarded = exportedActions(read("employee-project-actions.ts"))
      .filter((action) => !action.body.includes("await requireEmployee();"))
      .map((action) => action.name);

    assert.deepEqual(unguarded, [], `these reach a client's page with no session check: ${unguarded.join(", ")}`);
  });
});
