import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Who may set whose face, from the phone. Two doors and one rule: somebody
// sets their own face, and only the manager sets anybody else's.
//
//   - `POST /api/mobile/me/photo` writes the caller's *own* row — an
//     employee's token its own id, the manager's token the manager's own row —
//     and takes nothing from the body but the picture.
//   - `team/employees/photo` sets anybody's, through the website's own
//     `setEmployeePhoto`, which is behind `requireAdmin`.
//
// Get either wrong and it still typechecks, lints, builds and passes every
// other test: a route that read an id from the form would let one person
// change another's face with a hand-written request, and nothing on any
// screen would say so. So the rule is pinned where it is written.

const root = process.cwd();
const read = (...path: string[]) => readFileSync(join(root, ...path), "utf8");

describe("setting your own face from the phone", () => {
  const route = read("src", "app", "api", "mobile", "me", "photo", "route.ts");

  it("reads nothing from the form but the picture", () => {
    const fields = [...route.matchAll(/formData\.get\(\s*"([^"]+)"\s*\)/g)].map((match) => match[1]);
    assert.deepEqual(fields, ["photo"]);
    assert.doesNotMatch(route, /request\.json\(/, "the route must not read a body that could name somebody");
  });

  it("decides whose face from the token: the employee themselves, or the manager's own row", () => {
    assert.match(route, /mobileViewer\(request\)/);
    assert.match(route, /viewer\.type === "ADMIN" \? managerEmployeeId\(\) : viewer\.id/);
  });

  it("tells a manager with no row so, rather than failing somewhere deeper", () => {
    assert.match(route, /status: 409/);
  });
});

describe("the manager setting anybody's face", () => {
  it("goes through the website's own action, which is the manager's alone", () => {
    const registry = read("src", "lib", "mobile", "registry", "team.ts");
    const start = registry.indexOf('"team/employees/photo"');
    assert.ok(start >= 0, "team/employees/photo is registered");
    const entry = registry.slice(start, registry.indexOf("\n  },", start));
    assert.match(entry, /await setEmployeePhoto\(id, input\.form\)/);

    const actions = read("src", "lib", "actions", "admin-employee-actions.ts");
    const body = actions.slice(actions.indexOf("export async function setEmployeePhoto"));
    assert.match(body.slice(0, body.indexOf("\n}")), /^[\s\S]*?\{\s*await requireAdmin\(\);/);
  });
});
