import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildToNote, parseBuild, plausibleBuild } from "../src/lib/ios-build";

// The iPhone app's build, and asking everybody on an older one to update.
// One number decides whether the whole team can use the app: written too
// high, every phone sits behind an update screen for a build that does not
// exist. So what is believed, and what may raise it, is pinned here.

describe("reading a build number", () => {
  it("takes exactly twelve digits that are a real date and time", () => {
    assert.equal(parseBuild("202610021122"), 202610021122);
    assert.equal(parseBuild("202802291200"), 202802291200); // 2028 is a leap year
    assert.equal(parseBuild("202612312359"), 202612312359);
  });

  it("refuses anything else, rather than reading part of it", () => {
    for (const raw of [
      "20261002112", // eleven
      "2026100211220", // thirteen
      " 202610021122",
      "2026-10-02 11:22",
      "20261002112a",
      "202613021122", // month 13
      "202610001122", // day 0
      "202609311122", // 31 September
      "202602291200", // 2026 is not a leap year
      "202610022400", // hour 24
      "202610021160", // minute 60
      "",
      null,
      undefined,
    ]) {
      assert.equal(parseBuild(raw), null, String(raw));
    }
  });
});

describe("whether a build could be real", () => {
  const now = new Date("2026-10-02T12:00:00Z");

  it("starts in 2026", () => {
    assert.equal(plausibleBuild(202512312359, now), false);
    assert.equal(plausibleBuild(202601010000, now), true);
  });

  it("is never more than 36 hours ahead of the server's clock", () => {
    assert.equal(plausibleBuild(202610040000, now), true); // exactly 36 hours on
    assert.equal(plausibleBuild(202610040001, now), false);
    // The kind of number one forged header would try.
    assert.equal(plausibleBuild(999912312359, now), false);
  });

  it("is a build number at all", () => {
    assert.equal(plausibleBuild(20261002, now), false);
    assert.equal(plausibleBuild(Number.NaN, now), false);
  });
});

describe("what one request may raise it to", () => {
  const now = new Date("2026-10-02T12:00:00Z");
  const from = (channel: string | null, build: string | null = "202610021122") => ({ build, channel });

  it("counts TestFlight and the App Store, never a build from Xcode", () => {
    assert.equal(buildToNote(from("testflight"), null, now), 202610021122);
    assert.equal(buildToNote(from("appstore"), null, now), 202610021122);
    assert.equal(buildToNote(from("TestFlight"), null, now), 202610021122);
    assert.equal(buildToNote(from("dev"), null, now), null);
    assert.equal(buildToNote(from(null), null, now), null);
    assert.equal(buildToNote(from("enterprise"), null, now), null);
  });

  it("only ever goes up", () => {
    assert.equal(buildToNote(from("testflight"), 202610011500, now), 202610021122);
    assert.equal(buildToNote(from("testflight"), 202610021122, now), null);
    assert.equal(buildToNote(from("testflight"), 202610030900, now), null);
  });

  it("believes no build that could not be real", () => {
    assert.equal(buildToNote(from("testflight", "202610050000"), null, now), null);
    assert.equal(buildToNote(from("testflight", "202509011200"), null, now), null);
    assert.equal(buildToNote(from("testflight", "lots"), null, now), null);
    assert.equal(buildToNote(from("testflight", null), null, now), null);
  });
});

describe("the wiring the update screen depends on", () => {
  const root = process.cwd();

  it("notes the build only once the session is accepted, and stamps every answer", () => {
    for (const [method, folder] of [
      ["GET", "get"],
      ["POST", "do"],
    ]) {
      // Line endings normalised: git checks this repository out with CRLF on
      // Windows, where the office PC verifies every deploy, and a pattern written
      // with a newline escape then matches nothing. These assertions are about the
      // code, not about which machine read it.
      const route = readFileSync(
        join(root, "src", "app", "api", "mobile", folder, "[...name]", "route.ts"),
        "utf8"
      ).replace(/\r\n/g, "\n");
      assert.match(route, new RegExp(`export async function ${method}\\([^)]*\\) \\{\\n  return withLatestBuild\\(await `));
      const refused = route.indexOf('return json({ error: "Unauthorized." }, 401);');
      const noted = route.indexOf("noteAppBuild(request.headers);");
      assert.ok(refused > 0 && noted > refused, `${folder}: the build is noted before the session is checked`);
    }
  });
});
