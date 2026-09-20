import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deviceOutcome, isApnsConfigured, isGone, type ApnsResult } from "../src/lib/notifications/apns";
import { subscriptionOutcome } from "../src/lib/notifications/push";

const failed = (statusCode: number | null, error = "x", gone = false): ApnsResult => ({
  ok: false,
  statusCode,
  error,
  gone,
});

describe("what Apple is actually saying about a device", () => {
  it("treats only a disowned token as gone for good", () => {
    // 410 Unregistered: the app was deleted, or the token was reissued.
    assert.equal(isGone(410, "Unregistered"), true);
    assert.equal(isGone(410, null), true);

    // 400 has two reasons that mean the same thing.
    assert.equal(isGone(400, "BadDeviceToken"), true);
    assert.equal(isGone(400, "DeviceTokenNotForTopic"), true);
  });

  it("never retires a device over something that might work next time", () => {
    // The one that matters most: 403 is OUR key being wrong, not their phone.
    // Reading it as "gone" would retire every device in the studio, one
    // notification at a time, and the recovery is re-registering each phone
    // by hand — a configuration mistake turned into an outage.
    assert.equal(isGone(403, "InvalidProviderToken"), false);
    assert.equal(isGone(403, "ExpiredProviderToken"), false);

    assert.equal(isGone(429, "TooManyRequests"), false);
    assert.equal(isGone(503, "ServiceUnavailable"), false);
    assert.equal(isGone(500, null), false);
    assert.equal(isGone(400, "PayloadTooLarge"), false);
    // No answer at all — a timeout or a dropped socket — is not a verdict.
    assert.equal(isGone(null, null), false);
  });
});

describe("what a send result means for the device row", () => {
  it("clears the failure count on success", () => {
    assert.deepEqual(deviceOutcome({ ok: true, statusCode: 200 }, 7), {
      active: true,
      failureCount: 0,
      status: "SENT",
    });
  });

  it("retires a device Apple has disowned, without counting it as a failure", () => {
    assert.deepEqual(deviceOutcome(failed(410, "Unregistered", true), 2), {
      active: false,
      failureCount: 2,
      status: "EXPIRED",
    });
  });

  it("keeps trying a transient failure, but not forever", () => {
    assert.deepEqual(deviceOutcome(failed(503), 0), {
      active: true,
      failureCount: 1,
      status: "FAILED",
    });
    // The last try before it gives up.
    assert.deepEqual(deviceOutcome(failed(503), 8), {
      active: true,
      failureCount: 9,
      status: "FAILED",
    });
    assert.deepEqual(deviceOutcome(failed(503), 9), {
      active: false,
      failureCount: 10,
      status: "FAILED",
    });
  });

  it("decides exactly what the web-push policy decides", () => {
    // The two transports must retire devices on the same terms, or the studio
    // gets a different answer to "why did they stop getting notifications"
    // depending on which phone they hold. If one policy is ever changed, this
    // is what says the other was forgotten.
    for (const count of [0, 5, 9]) {
      assert.deepEqual(
        deviceOutcome(failed(503), count),
        subscriptionOutcome({ ok: false, statusCode: 503, error: "x", gone: false }, count)
      );
      assert.deepEqual(
        deviceOutcome(failed(410, "Unregistered", true), count),
        subscriptionOutcome({ ok: false, statusCode: 410, error: "x", gone: true }, count)
      );
    }
    assert.deepEqual(
      deviceOutcome({ ok: true, statusCode: 200 }, 3),
      subscriptionOutcome({ ok: true, statusCode: 201 }, 3)
    );
  });
});

describe("APNs with nothing configured", () => {
  it("says so rather than throwing, so the engine simply skips it", () => {
    const saved = [process.env.APNS_KEY_ID, process.env.APNS_TEAM_ID, process.env.APNS_PRIVATE_KEY];
    delete process.env.APNS_KEY_ID;
    delete process.env.APNS_TEAM_ID;
    delete process.env.APNS_PRIVATE_KEY;

    assert.equal(isApnsConfigured(), false);

    // All three are required: two out of three is a half-configured install,
    // which must read as "off" rather than as "on and broken".
    process.env.APNS_KEY_ID = "ABC123";
    process.env.APNS_TEAM_ID = "745F9U99BC";
    assert.equal(isApnsConfigured(), false);

    process.env.APNS_PRIVATE_KEY = "-----BEGIN PRIVATE KEY-----\\nx\\n-----END PRIVATE KEY-----";
    assert.equal(isApnsConfigured(), true);

    [process.env.APNS_KEY_ID, process.env.APNS_TEAM_ID, process.env.APNS_PRIVATE_KEY] = saved;
    if (saved[0] === undefined) delete process.env.APNS_KEY_ID;
    if (saved[1] === undefined) delete process.env.APNS_TEAM_ID;
    if (saved[2] === undefined) delete process.env.APNS_PRIVATE_KEY;
  });
});
