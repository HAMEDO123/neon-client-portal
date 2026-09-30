import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The VoIP push is the one piece of this platform that cannot be checked by
// running it: it needs Apple, a real device and a locked screen. So what is
// pinned here is the shape — the three things that make a push a *call* push
// rather than a banner, and the obligation that comes with accepting one.
//
// Every one of these is a silent failure if it drifts. A wrong topic is
// refused by Apple with a reason nobody reads; a wrong push type arrives as
// nothing; a missing `ended` event gets the app killed by iOS for reporting
// no call.

const apns = readFileSync(join(process.cwd(), "src", "lib", "notifications", "apns.ts"), "utf8");
const callPush = readFileSync(join(process.cwd(), "src", "lib", "notifications", "call-push.ts"), "utf8");
const engine = readFileSync(join(process.cwd(), "src", "lib", "notifications", "engine.ts"), "utf8");
const store = readFileSync(join(process.cwd(), "src", "lib", "call-store.ts"), "utf8");

describe("what makes a push able to ring a phone", () => {
  it("addresses PushKit's own topic, not the bundle id", () => {
    // `<bundle>.voip` is a different topic from `<bundle>`. Sent to the
    // second, a VoIP push is refused and nothing rings.
    assert.match(apns, /\$\{target\.bundleId\}\.voip/);
  });

  it("sends it as a voip push", () => {
    assert.match(apns, /"voip",\s*`\$\{target\.bundleId\}\.voip`/);
  });

  it("carries no alert, because iOS draws nothing and the app does", () => {
    // The body is the call itself. An `aps.alert` here would draw a banner
    // *and* wake the app, which is the worst of both.
    const send = apns.slice(apns.indexOf("export async function sendCallPush"));
    const body = send.slice(0, send.indexOf("try {"));
    assert.ok(!body.includes("aps"), "a call push must not carry an aps alert");
  });
});

describe("the obligation that comes with waking an app", () => {
  it("tells the phones when the call is over", () => {
    // iOS kills an app that accepts a VoIP push and reports no call to
    // CallKit. A call that ended before the phone woke must still be sent, or
    // the app is punished for the server's silence.
    assert.match(callPush, /export async function stopRinging/);
    assert.match(store, /stopRinging\(/);
  });

  it("rings when a call starts", () => {
    assert.match(store, /ringPhones\(/);
  });

  it("never lets a push decide whether a call happens", () => {
    // Both are fired and forgotten. A call already ringing on every open
    // screen must not wait on Apple, and a push that fails must not undo it.
    assert.match(store, /void ringPhones\(/);
    assert.match(store, /void stopRinging\(/);
  });
});

describe("the two tokens are kept apart", () => {
  it("sends ordinary notifications only to alert tokens", () => {
    // A VoIP token handed an ordinary push is refused, and the refusal counts
    // against it until a working token is retired. This is the line that stops
    // the engine burning them.
    assert.match(engine, /kind:\s*"ALERT"/);
  });

  it("rings only voip tokens", () => {
    assert.match(callPush, /kind:\s*"VOIP"/);
  });
});
