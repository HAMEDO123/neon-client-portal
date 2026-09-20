import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Set before anything signs: `getSecret()` is read at call time, not at import,
// so this is enough and the suite needs no database and no .env.
process.env.SESSION_SECRET ??= "test-secret-for-mobile-auth";

import {
  createEmployeeSessionToken,
  createSessionToken,
  verifyEmployeeSessionToken,
} from "../src/lib/auth";
import { bearerToken, requireMobileAuth } from "../src/lib/mobile-auth";

const withHeader = (value?: string) =>
  new Request("http://localhost:3010/api/mobile/me", {
    headers: value === undefined ? {} : { authorization: value },
  });

describe("the token on a mobile request", () => {
  it("is what follows Bearer, and nothing else counts", () => {
    assert.equal(bearerToken(withHeader("Bearer abc.def")), "abc.def");
    assert.equal(bearerToken(withHeader()), null);
    assert.equal(bearerToken(withHeader("")), null);
    assert.equal(bearerToken(withHeader("Basic abc.def")), null);
    // A bare token with no scheme is not a Bearer token. Accepting it would
    // mean two spellings of the same credential, and only one of them tested.
    assert.equal(bearerToken(withHeader("abc.def")), null);
    // The scheme is case-sensitive here because the header is ours to send.
    assert.equal(bearerToken(withHeader("bearer abc.def")), null);
  });
});

describe("the manager's token and an employee's token", () => {
  // The one property the whole mobile API rests on. Both tokens are HMACs over
  // the same SESSION_SECRET and differ only by a prefix inside the signed
  // payload, so if that separation ever broke, every admin-only route would
  // start accepting employees — and nothing else we run would notice.
  it("never verify as each other", () => {
    const admin = createSessionToken();
    const employee = createEmployeeSessionToken("employee-123");

    assert.equal(requireMobileAuth(withHeader(`Bearer ${admin}`)), true);
    assert.equal(verifyEmployeeSessionToken(employee), "employee-123");

    // The crossings, which are the point of the test.
    assert.equal(requireMobileAuth(withHeader(`Bearer ${employee}`)), false);
    assert.equal(verifyEmployeeSessionToken(admin), null);
  });

  it("are refused when absent, malformed or tampered with", () => {
    assert.equal(requireMobileAuth(withHeader()), false);
    assert.equal(requireMobileAuth(withHeader("Bearer ")), false);
    assert.equal(requireMobileAuth(withHeader("Bearer not-a-token")), false);
    assert.equal(verifyEmployeeSessionToken("only.two"), null);
    assert.equal(verifyEmployeeSessionToken(null), null);

    // Same employee, same expiry, one character of the signature changed.
    const token = createEmployeeSessionToken("employee-123");
    const [id, expiresAt, signature] = token.split(".");
    const flipped = signature[0] === "a" ? "b" : "a";
    assert.equal(verifyEmployeeSessionToken(`${id}.${expiresAt}.${flipped}${signature.slice(1)}`), null);

    // And the same signature claimed for a different employee.
    assert.equal(verifyEmployeeSessionToken(`employee-999.${expiresAt}.${signature}`), null);
  });

  it("stop working once they have expired", () => {
    // Signed by us, genuinely — just past its expiry, which is the one thing a
    // valid signature must not be allowed to excuse.
    const past = Date.now() - 1000;
    assert.equal(verifyEmployeeSessionToken(`employee-123.${past}.whatever`), null);
    assert.equal(requireMobileAuth(withHeader(`Bearer ${past}.whatever`)), false);
  });
});
