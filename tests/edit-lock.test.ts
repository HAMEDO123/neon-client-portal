import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  createAdminSessionToken,
  createEmployeeSessionToken,
  lockedAdminSessionToken,
  verifyAdminSession,
  verifyEmployeeSessionToken,
} from "../src/lib/auth";
import { passwordComplaint, MIN_ADMIN_PASSWORD } from "../src/lib/admin-password";

// The hour of editing (lib/admin-password.ts, lib/admin-guard.ts).
//
// The studio runs this platform on a PC in the studio, and a browser left
// signed in on it was, until 2026-11-03, the whole of the credential. So an
// admin session now carries two clocks — a week for reading, an hour for
// changing anything — and the password is what buys another hour.
//
// What has to hold, and what breaks silently if it stops holding:
//
//   - the three facts in the token (session expiry, unlock expiry, which
//     password it was issued under) are all signed, so none of them can be
//     moved by whoever is holding it;
//   - a locked session still *reads*, or the manager cannot look at today's
//     attendance without typing a password, and a lock like that gets removed;
//   - an admin token and an employee token can never be mistaken for each
//     other, which was true before the format changed and has to stay true;
//   - and no write reaches for the reading guard, which is the one way the
//     lock could quietly stop applying to something.

describe("an admin session carries its own hour", () => {
  it("arrives able to edit", async () => {
    const session = await verifyAdminSession(await createAdminSessionToken());

    assert.ok(session, "a token just issued must verify");
    assert.equal(session.unlocked, true);
    assert.ok(session.unlockedUntil > Date.now(), "the hour is ahead of us");
  });

  it("still reads once the hour is up, and says it may not edit", async () => {
    const locked = await lockedAdminSessionToken(await createAdminSessionToken());
    assert.ok(locked, "locking a live session must give a token back");

    // This is the half that matters most: null here would mean a locked
    // platform signs the manager out instead of asking for the password, and
    // the manager would stop using the lock within a day.
    const session = await verifyAdminSession(locked);
    assert.ok(session, "a locked session is still a session");
    assert.equal(session.unlocked, false);
  });

  it("refuses to lock a token that was not a session to begin with", async () => {
    assert.equal(await lockedAdminSessionToken(undefined), null);
    assert.equal(await lockedAdminSessionToken("nonsense"), null);
    assert.equal(await lockedAdminSessionToken("1999999999999.deadbeef"), null);
  });
});

describe("nothing in the token can be moved by hand", () => {
  it("refuses a longer hour", async () => {
    const [expiresAt, , epoch, signature] = (await createAdminSessionToken()).split(".");
    const forged = [expiresAt, String(Date.now() + 1000 * 60 * 60 * 24 * 365), epoch, signature].join(".");

    assert.equal(await verifyAdminSession(forged), null);
  });

  it("refuses a longer session", async () => {
    const [, unlockedUntil, epoch, signature] = (await createAdminSessionToken()).split(".");
    const forged = [String(Date.now() + 1000 * 60 * 60 * 24 * 365), unlockedUntil, epoch, signature].join(".");

    assert.equal(await verifyAdminSession(forged), null);
  });

  it("refuses another password's fingerprint", async () => {
    // What makes changing the password end other people's sessions: a token
    // whose epoch is not the one in force cannot be re-signed without the
    // secret, so it stops verifying the moment the password moves.
    const [expiresAt, unlockedUntil, , signature] = (await createAdminSessionToken()).split(".");
    const forged = [expiresAt, unlockedUntil, "000000000000", signature].join(".");

    assert.equal(await verifyAdminSession(forged), null);
  });

  it("refuses the two-part token the platform used to issue", async () => {
    // A session from before the hour existed. Everybody signs in again once,
    // which is the right trade: the alternative is accepting a token that says
    // nothing about which password it was issued under.
    const expiresAt = Date.now() + 1000 * 60 * 60;
    assert.equal(await verifyAdminSession(`${expiresAt}.deadbeef`), null);
  });

  it("keeps the manager's token and an employee's apart, in both directions", async () => {
    const admin = await createAdminSessionToken();
    const employee = createEmployeeSessionToken("emp-1");

    assert.equal(verifyEmployeeSessionToken(admin), null, "an admin token is not employee emp-1");
    assert.equal(await verifyAdminSession(employee), null, "an employee token is not the manager");
  });
});

describe("what the platform will accept as a new password", () => {
  it("asks for enough of it, and for the same twice", () => {
    const short = "a".repeat(MIN_ADMIN_PASSWORD - 1);
    const fine = "a".repeat(MIN_ADMIN_PASSWORD);

    assert.ok(passwordComplaint(short, short), "too short must be refused");
    assert.ok(passwordComplaint(fine, `${fine}x`), "a mistyped confirmation must be refused");
    assert.equal(passwordComplaint(fine, fine), null);
  });
});

describe("the reading guard never guards a write", () => {
  const ACTIONS = join(process.cwd(), "src", "lib", "actions");

  /**
   * The one action file allowed to check at reading level, with the reason.
   *
   * These three write a row, but the row is this browser's own push
   * subscription rather than anything of the studio's — and the first of them
   * runs by itself when the dashboard opens, so behind the lock it would ask
   * the manager for a password to turn a bell on.
   */
  const MAY_READ_ONLY = new Set(["admin-push-actions.ts"]);

  it("is not reached for in any other action file", () => {
    const reaching = readdirSync(ACTIONS)
      .filter((file) => file.endsWith(".ts") && !MAY_READ_ONLY.has(file))
      .filter((file) => readFileSync(join(ACTIONS, file), "utf8").includes("requireAdminRead"));

    assert.deepEqual(
      reaching,
      [],
      "an action that changes something must use requireAdmin, which is the one that checks the hour"
    );
  });

  it("is still the guard the manager's own pages read behind", () => {
    // The other direction: if these ever went back to `requireAdmin`, a locked
    // session would get an error page instead of a readable screen.
    for (const page of [
      join("src", "app", "admin", "(dashboard)", "site-visits", "page.tsx"),
      join("src", "app", "admin", "(dashboard)", "tasks", "job", "[id]", "page.tsx"),
    ]) {
      const source = readFileSync(join(process.cwd(), page), "utf8");
      assert.ok(source.includes("await requireAdminRead();"), `${page} must read at reading level`);
    }
  });

  it("checks the hour inside requireAdmin itself, not at the call sites", () => {
    // Sixty actions call `requireAdmin`. If the hour were checked beside each
    // of them instead of inside it, the sixty-first would be written without
    // it and nothing would notice.
    const guard = readFileSync(join(process.cwd(), "src", "lib", "admin-guard.ts"), "utf8");
    const body = guard.slice(guard.indexOf("export async function requireAdmin("));

    assert.match(body.slice(0, 400), /session\.unlocked/, "requireAdmin must refuse a locked session");
    assert.match(body.slice(0, 400), /throw new Error\(LOCKED\)/);
  });
});
