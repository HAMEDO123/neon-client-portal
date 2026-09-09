import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { deviceLabel, describeDevice } from "../src/lib/devices";

// Real strings, because this is the one place where a made-up one proves
// nothing: every browser lies about being every other browser.
const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const ANDROID_TABLET =
  "Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WINDOWS_EDGE =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.68";
const MAC_SAFARI =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPAD_SAFARI =
  "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/604.1";

describe("naming a device", () => {
  it("tells the phones apart", () => {
    assert.equal(deviceLabel(IPHONE_SAFARI), "iPhone · Safari");
    assert.equal(deviceLabel(ANDROID_CHROME), "Android phone · Chrome");
  });

  it("tells a tablet from a phone", () => {
    assert.equal(describeDevice(IPAD_SAFARI).device, "iPad");
    // Android says "Mobile" on a phone and not on a tablet, and that is the
    // only thing separating them.
    assert.equal(describeDevice(ANDROID_TABLET).device, "Android tablet");
    assert.equal(describeDevice(ANDROID_CHROME).device, "Android phone");
  });

  it("is not fooled by a browser pretending to be Safari", () => {
    // Chrome on iOS is WebKit and says Safari; Edge says both Chrome and Safari.
    assert.equal(describeDevice(IPHONE_CHROME).browser, "Chrome");
    assert.equal(describeDevice(WINDOWS_EDGE).browser, "Edge");
    assert.equal(describeDevice(MAC_SAFARI).browser, "Safari");
  });

  it("names the computers too", () => {
    assert.equal(deviceLabel(WINDOWS_EDGE), "Windows PC · Edge");
    assert.equal(deviceLabel(MAC_SAFARI), "Mac · Safari");
  });

  it("says something rather than nothing when the browser says nothing", () => {
    assert.equal(deviceLabel(null), "Unknown device");
    assert.equal(deviceLabel(""), "Unknown device");
    assert.equal(deviceLabel("   "), "Unknown device");
    assert.equal(describeDevice("something unrecognisable").browser, null);
  });
});
