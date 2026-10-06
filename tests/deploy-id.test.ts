import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The deploy id has to be the same thing in three places, and nothing we run
// notices when it is not.
//
// From 2026-10-03 to 2026-10-06 the Dockerfile gave it to `next build` and to
// nothing else. The pages' JavaScript carried it; the running server, reading
// next.config.ts again with the variable gone, had none. Next reloads the whole
// document when the two disagree — so every link reloaded the page and every
// server action wiped what was on it. It typechecked, linted, built, passed
// every test and served every request with a 200.
//
// So these read the three files and hold them to one name. Git checks these
// files out with CRLF on Windows, hence the normalising.

const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

const STAMP = ".deploy-id";

describe("the deploy id, at build time and at run time", () => {
  it("is written to a file by the same step that builds", () => {
    const dockerfile = read("Dockerfile");
    const build = dockerfile.split("\n\n").find((block) => block.includes("npm run build"));
    assert.ok(build, "the Dockerfile no longer builds?");
    assert.ok(build.includes(`> ${STAMP}`), "the build step must write the id to .deploy-id");
    assert.ok(build.includes(`NEON_DEPLOY_ID="$(cat ${STAMP})"`), "the build must be given the id it just wrote, not a second one");
  });

  it("is read back from that file by the config next start loads", () => {
    const config = read("next.config.ts");
    assert.ok(config.includes(`"${STAMP}"`), "next.config.ts must fall back to .deploy-id at run time");
    assert.match(config, /deploymentId:\s*deployId\(\)/);
  });

  // With a deploy id set, Next keeps .next/BUILD_ID constant on purpose. A
  // version read from it never changes, and the "new version" prompt compares
  // a constant with itself for ever.
  it("is what the reload prompt compares, ahead of the build id", () => {
    const version = read("src", "lib", "app-version.ts");
    const stamp = version.indexOf(`fileAt("${STAMP}")`);
    const buildId = version.indexOf('fileAt(".next", "BUILD_ID")');
    assert.ok(stamp > 0, "app-version.ts must read .deploy-id");
    assert.ok(buildId > stamp, "…and before the build id, which is constant once a deploy id is set");
  });

  it("never rides in from this folder", () => {
    assert.ok(read(".dockerignore").split("\n").includes(STAMP), ".deploy-id must be in .dockerignore");
    assert.ok(read(".gitignore").split("\n").includes(`/${STAMP}`), ".deploy-id must be in .gitignore");
  });
});
