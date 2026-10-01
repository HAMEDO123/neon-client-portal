import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  OnvifCamera,
  OnvifError,
  attrOf,
  calls,
  createdStamp,
  elements,
  envelope,
  movableProfile,
  parseCapabilities,
  parseDeviceTime,
  parseFault,
  parsePresets,
  parseProfiles,
  passwordDigest,
  securityHeader,
  textOf,
  xmlEscape,
} from "../src/lib/onvif";
import { onvifStandIn, type StandIn } from "./onvif-camera";

// Moving a camera (lib/onvif.ts): pan and tilt over ONVIF, as Tapo cameras
// answer it on port 2020 with their Camera Account.

describe("signing a request", () => {
  it("computes WS-Security's PasswordDigest as the ONVIF programmer's guide does", () => {
    // The guide's own example: nonce, date and password in, digest out.
    const nonce = Buffer.from("LKqI6G/AikKCQrN0zqZFlg==", "base64");
    assert.equal(passwordDigest(nonce, "2010-09-16T07:50:45Z", "userpassword"), "tuOSpGlFlIXsozq4HFNeeGeFLEI=");
  });

  it("writes Created in UTC to the second, as cameras expect it", () => {
    assert.equal(createdStamp(new Date("2026-10-01T14:03:07.123Z")), "2026-10-01T14:03:07Z");
  });

  it("puts the token in a SOAP 1.2 envelope, escaping the username", () => {
    const nonce = Buffer.from("0123456789abcdef");
    const header = securityHeader("a&b<c", "pw", "2026-10-01T14:03:07Z", nonce);
    assert.match(header, /<Username>a&amp;b&lt;c<\/Username>/);
    assert.match(header, /#PasswordDigest">[A-Za-z0-9+/=]+<\/Password>/);
    assert.match(header, new RegExp(`<Nonce [^>]*>${nonce.toString("base64").replace(/[+/=]/g, "\\$&")}</Nonce>`));
    const message = envelope(calls.capabilities(), header);
    assert.match(message, /^<\?xml version="1.0" encoding="UTF-8"\?><s:Envelope xmlns:s="http:\/\/www.w3.org\/2003\/05\/soap-envelope"><s:Header><Security s:mustUnderstand="1"/);
    assert.ok(!envelope(calls.systemDateAndTime()).includes("<s:Header>"), "asking the time needs no sign-in");
  });

  it("writes a move with a velocity and a timeout, and escapes every token it is handed", () => {
    assert.match(calls.continuousMove("profile_1", 0.5, -1, 1), /<PanTilt x="0.5" y="-1" xmlns="http:\/\/www.onvif.org\/ver10\/schema"\/>.*<Timeout>PT1S<\/Timeout>/);
    assert.match(calls.continuousMove("p", 0.123456, 0, 0.5), /x="0.12".*<Timeout>PT0.5S<\/Timeout>/);
    assert.match(calls.gotoPreset("p", "1\"><x"), /<PresetToken>1&quot;&gt;&lt;x<\/PresetToken>/);
    assert.equal(xmlEscape(`<'&">`), "&lt;&apos;&amp;&quot;&gt;");
  });
});

describe("reading what a camera answers", () => {
  const tapoTime =
    '<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"><SOAP-ENV:Body>' +
    "<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:DateTimeType>NTP</tt:DateTimeType>" +
    "<tt:UTCDateTime><tt:Time><tt:Hour>14</tt:Hour><tt:Minute>3</tt:Minute><tt:Second>7</tt:Second></tt:Time><tt:Date><tt:Year>2026</tt:Year><tt:Month>10</tt:Month><tt:Day>1</tt:Day></tt:Date></tt:UTCDateTime>" +
    "<tt:LocalDateTime><tt:Time><tt:Hour>17</tt:Hour><tt:Minute>3</tt:Minute><tt:Second>7</tt:Second></tt:Time><tt:Date><tt:Year>2026</tt:Year><tt:Month>10</tt:Month><tt:Day>1</tt:Day></tt:Date></tt:LocalDateTime>" +
    "</tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>";

  it("reads the camera's UTC clock, not its local one", () => {
    assert.equal(parseDeviceTime(tapoTime)?.toISOString(), "2026-10-01T14:03:07.000Z");
    assert.equal(parseDeviceTime("<x/>"), null);
  });

  it("finds the media and PTZ services, and knows a camera without PTZ", () => {
    const xml =
      "<tds:Capabilities><tt:Device><tt:XAddr>http://cam:2020/onvif/device_service</tt:XAddr></tt:Device>" +
      "<tt:Media><tt:XAddr>http://cam:2020/onvif/service</tt:XAddr><tt:StreamingCapabilities/></tt:Media>" +
      "<tt:PTZ><tt:XAddr>http://cam:2020/onvif/ptz</tt:XAddr></tt:PTZ></tds:Capabilities>";
    assert.deepEqual(parseCapabilities(xml), { media: "http://cam:2020/onvif/service", ptz: "http://cam:2020/onvif/ptz" });
    assert.deepEqual(parseCapabilities(xml.replace(/<tt:PTZ>.*<\/tt:PTZ>/, "")), { media: "http://cam:2020/onvif/service", ptz: null });
  });

  it("picks the first profile that can pan and tilt", () => {
    const xml =
      '<trt:Profiles fixed="true" token="profile_1"><tt:Name>mainStream</tt:Name><tt:VideoSourceConfiguration token="v"><tt:Name>VideoSource</tt:Name></tt:VideoSourceConfiguration></trt:Profiles>' +
      '<trt:Profiles token=\'profile_2\'><tt:Name>minorStream</tt:Name><tt:PTZConfiguration token="ptz"><tt:Name>PTZ</tt:Name></tt:PTZConfiguration></trt:Profiles>';
    const profiles = parseProfiles(xml);
    assert.deepEqual(profiles, [
      { token: "profile_1", name: "mainStream", ptz: false },
      { token: "profile_2", name: "minorStream", ptz: true },
    ]);
    assert.equal(movableProfile(profiles), "profile_2");
    assert.equal(movableProfile([profiles[0]]), null);
  });

  it("reads the saved positions, Arabic names and all, and not a PresetToken", () => {
    const xml =
      '<tptz:GetPresetsResponse><tptz:Preset token="1"><tt:Name>Door</tt:Name><tt:PTZPosition/></tptz:Preset>' +
      '<tptz:Preset token="2"><tt:Name>المكتب &amp; الباب</tt:Name></tptz:Preset><tptz:PresetToken>9</tptz:PresetToken></tptz:GetPresetsResponse>';
    assert.deepEqual(parsePresets(xml), [
      { token: "1", name: "Door" },
      { token: "2", name: "المكتب & الباب" },
    ]);
  });

  it("knows a refused account in a SOAP fault", () => {
    const fault =
      "<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value><SOAP-ENV:Subcode><SOAP-ENV:Value>ter:NotAuthorized</SOAP-ENV:Value></SOAP-ENV:Subcode></SOAP-ENV:Code>" +
      '<SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">Sender not Authorized</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>';
    assert.deepEqual(parseFault(fault), { reason: "Sender not Authorized", notAuthorized: true });
    assert.deepEqual(parseFault("<s:Fault><s:Reason><s:Text>Action not supported</s:Text></s:Reason></s:Fault>"), {
      reason: "Action not supported",
      notAuthorized: false,
    });
    assert.equal(parseFault("<tptz:StopResponse/>"), null);
  });

  it("reads elements by local name, whatever the prefix, and not a longer name that starts the same", () => {
    assert.deepEqual(
      elements("<a:Media x='1'>m</a:Media><Media2>no</Media2><b:Media/>", "Media").map((element) => element.inner),
      ["m", ""]
    );
    assert.equal(textOf("<tt:Name> Front &lt;door&gt; </tt:Name>", "Name"), "Front <door>");
    assert.equal(attrOf(' fixed="true" token="profile_1"', "token"), "profile_1");
    assert.equal(attrOf(" tokens='x'", "token"), null);
  });
});

describe("talking to a camera, against a stand-in Tapo", () => {
  let camera: StandIn;
  before(async () => {
    camera = await onvifStandIn({ username: "viewer", password: "p&ss<word>", skewMs: 2 * 60 * 60_000 });
  });
  after(async () => camera.close());

  it("signs in on the camera's clock — two hours out — and finds the profile to move", async () => {
    const onvif = new OnvifCamera(camera.url, "viewer", "p&ss<word>");
    const session = await onvif.connect();
    assert.equal(session.profile, "profile_1");
    assert.ok(Math.abs(session.skew - 2 * 60 * 60_000) < 5_000, `skew ${session.skew}`);
    assert.equal(camera.refused, 0);
  });

  it("moves for a second, stops, lists and visits saved positions", async () => {
    const onvif = new OnvifCamera(camera.url, "viewer", "p&ss<word>");
    await onvif.move(0.5, -1, 1);
    await onvif.stop();
    assert.deepEqual(camera.moves.at(-1), { x: 0.5, y: -1, timeout: "PT1S" });
    assert.equal(camera.stops, 1);
    assert.deepEqual(await onvif.presets(), [
      { token: "1", name: "Door" },
      { token: "2", name: "المكتب" },
    ]);
    await onvif.gotoPreset("2");
    assert.deepEqual(camera.gone, ["2"]);
  });

  it("says plainly when the Camera Account is refused", async () => {
    const onvif = new OnvifCamera(camera.url, "viewer", "wrong");
    await assert.rejects(onvif.connect(), (error: unknown) => error instanceof OnvifError && error.kind === "not-authorized");
  });

  it("is refused by the camera without the clock correction — which is why it is there", async () => {
    const before = camera.refused;
    const skewless = new OnvifCamera(camera.url, "viewer", "p&ss<word>", async (url, init) => {
      // Hide the camera's clock: GetSystemDateAndTime answers nothing usable.
      if (String(init?.body).includes("GetSystemDateAndTime")) return new Response("<nothing/>", { status: 200 });
      return fetch(url, init);
    });
    await assert.rejects(skewless.connect(), (error: unknown) => error instanceof OnvifError && error.kind === "not-authorized");
    assert.ok(camera.refused > before);
  });

  it("knows a camera that cannot move, and one that is not there", async () => {
    const fixed = await onvifStandIn({ fixed: true });
    try {
      await assert.rejects(new OnvifCamera(fixed.url, "viewer", "secret").connect(), (error: unknown) => error instanceof OnvifError && error.kind === "no-ptz");
    } finally {
      await fixed.close();
    }
    await assert.rejects(
      new OnvifCamera("http://127.0.0.1:9/onvif/device_service", "viewer", "secret").connect(),
      (error: unknown) => error instanceof OnvifError && error.kind === "unreachable"
    );
  });
});
