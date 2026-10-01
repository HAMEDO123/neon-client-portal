import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";

process.env.SESSION_SECRET ??= "test-secret-for-the-camera-tests";

import {
  CAMERA_ERRORS,
  DEFAULT_RELAY_URL,
  DIRECTIONS,
  STORED_ID_PATTERN,
  cameraIdParam,
  cameraIp,
  cameraName,
  cameraPort,
  cameraSources,
  explainRelayError,
  isCameraId,
  isMjpegStream,
  looksLikeJpeg,
  manualStreams,
  manualView,
  newCameraIdFrom,
  ownStreamCamera,
  readCameraForm,
  relayBase,
  relayUrl,
  snapshotWidth,
  sortCameras,
  streamNames,
  velocity,
  viewOf,
  type StoredCamera,
} from "../src/lib/cameras";
import {
  addPreload,
  camerasGate,
  fetchFrame,
  openLive,
  probeStream,
  registerStream,
  relayStreams,
  removeStream,
} from "../src/lib/mobile/cameras-relay";
import { createEmployeeSessionToken, createSessionToken } from "../src/lib/auth";

// The studio's cameras on the manager's phone (lib/cameras.ts,
// lib/mobile/cameras-*.ts, src/app/api/mobile/cameras/…, registry/cameras.ts).
//
// The rules that matter most here all still typecheck, lint, build and show
// cameras on the phone when they are broken:
//
//   - a camera's password never reaches the phone, and neither does the
//     relay's own stream list, which carries every password;
//   - go2rtc reads `src=` as a stream name *or a source to open*, so only a
//     name the server made, or one the relay itself lists, is ever sent;
//   - what somebody typed is never a stream name.

const camera = (over: Partial<StoredCamera> = {}): StoredCamera => ({
  id: "cabcdefghij",
  name: "Front door",
  ip: "192.168.1.21",
  username: "viewer",
  password: "p@ss word#1",
  ptz: null,
  addedAt: "2026-10-01T00:00:00.000Z",
  ...over,
});

describe("a camera's id", () => {
  it("is a name: letters in any script, digits, _ and -", () => {
    for (const id of ["front_door", "office-2", "CAM1", "مدخل_المكتب", "cabcdefghij", "neon_cabcdefghij_sd"]) {
      assert.equal(isCameraId(id), true, id);
    }
  });

  it("can never be read as an address, a command, a path or a query", () => {
    for (const id of [
      "rtsp://viewer:pw@192.168.1.2:554/stream1",
      "exec:rm -rf /",
      "ffmpeg:front_door#video=mjpeg",
      "front door",
      "../config",
      "cam.1",
      "cam?x=1",
      "cam%2F",
      "",
      "a".repeat(65),
    ]) {
      assert.equal(isCameraId(id), false, id);
    }
    assert.equal(isCameraId(undefined), false);
    assert.equal(isCameraId(42), false);
  });

  it("is made by the server, never typed: c and ten letters or digits", () => {
    const id = newCameraIdFrom(new Uint8Array([0, 1, 2, 25, 26, 35, 36, 200, 255, 7]));
    assert.match(id, STORED_ID_PATTERN);
    assert.equal(id.length, 11);
  });

  it("arrives from the route decoded, or is decoded once more, and nothing else", () => {
    assert.equal(cameraIdParam("cabcdefghij"), "cabcdefghij");
    assert.equal(cameraIdParam(encodeURIComponent("مدخل_المكتب")), "مدخل_المكتب");
    assert.equal(cameraIdParam(encodeURIComponent("rtsp://evil:554/x")), null);
    assert.equal(cameraIdParam("%E0%A4%A"), null);
    assert.equal(cameraIdParam(undefined), null);
  });
});

describe("what the phone is told about a camera", () => {
  it("never carries the password", () => {
    const view = viewOf(camera({ password: "hunter2-secret" }), true);
    assert.ok(!JSON.stringify(view).includes("hunter2"));
    assert.deepEqual(Object.keys(view).sort(), ["editable", "hasPassword", "id", "ip", "login", "name", "online", "ptz", "username"]);
    assert.equal(view.hasPassword, true);
    assert.equal(view.login, "camera-account");
    assert.equal(view.editable, true);
  });

  it("says a Tapo-login camera cannot be moved, whatever was stored", () => {
    const view = viewOf(camera({ username: "owner@example.com", ptz: true }));
    assert.equal(view.login, "tapo-account");
    assert.equal(view.ptz, false);
  });

  it("shows a hand-written one by a name made from its key, and as not editable", () => {
    assert.deepEqual(manualView("2_front_door"), {
      id: "2_front_door",
      name: "Front Door",
      ip: null,
      username: null,
      hasPassword: false,
      login: null,
      editable: false,
      ptz: null,
      online: null,
    });
  });

  it("names a key: underscores to spaces, capitals, the ordering number dropped, Arabic kept", () => {
    assert.equal(cameraName("front_door"), "Front Door");
    assert.equal(cameraName("lobby__left"), "Lobby Left");
    assert.equal(cameraName("2_studio"), "Studio");
    assert.equal(cameraName("3d_room"), "3d Room");
    assert.equal(cameraName("مدخل_المكتب"), "مدخل المكتب");
    assert.equal(cameraName("12"), "12");
    assert.equal(cameraName("___"), "___");
  });

  it("orders cameras by name, numbers read as numbers", () => {
    const sorted = sortCameras([
      { id: "a", name: "Store 10" },
      { id: "b", name: "Store 2" },
      { id: "c", name: "entrance" },
    ]);
    assert.deepEqual(sorted.map((item) => item.name), ["entrance", "Store 2", "Store 10"]);
  });
});

describe("the add/edit form", () => {
  const fields = { name: "  Front   door ", ip: "192.168.1.21", username: "viewer", password: "secret" };

  it("reads a new camera", () => {
    assert.deepEqual(readCameraForm(fields, false), {
      ok: true,
      form: { id: null, name: "Front door", ip: "192.168.1.21", username: "viewer", password: "secret" },
    });
  });

  it("keeps the saved password when editing with the box left empty", () => {
    const read = readCameraForm({ ...fields, id: "cabcdefghij", password: "" }, true);
    assert.equal(read.ok && read.form.password, null);
    assert.equal(read.ok && read.form.id, "cabcdefghij");
  });

  it("needs a password for a new camera, and an id of ours to edit", () => {
    assert.deepEqual(readCameraForm({ ...fields, password: "" }, false), { ok: false, error: "Type the password." });
    assert.equal(readCameraForm({ ...fields, id: "../x" }, true).ok, false);
  });

  it("refuses an address that cannot be a camera on the office network", () => {
    for (const ip of ["", "camera.local", "192.168.1", "192.168.1.256", "192.168.01.2", "127.0.0.1", "0.0.0.0", "239.1.1.1", "rtsp://192.168.1.2"]) {
      assert.equal(cameraIp(ip), null, ip);
      assert.equal(readCameraForm({ ...fields, ip }, false).ok, false, ip);
    }
    assert.equal(cameraIp(" 10.0.0.7 "), "10.0.0.7");
  });

  it("refuses a name, username or password nobody could have meant", () => {
    assert.equal(readCameraForm({ ...fields, name: "   " }, false).ok, false);
    assert.equal(readCameraForm({ ...fields, name: "x".repeat(41) }, false).ok, false);
    assert.equal(readCameraForm({ ...fields, username: "two words" }, false).ok, false);
    assert.equal(readCameraForm({ ...fields, password: "line\nbreak" }, false).ok, false);
  });
});

describe("what the relay is told", () => {
  it("names four streams per camera, all of them ours", () => {
    const names = streamNames("cabcdefghij");
    assert.deepEqual(names, {
      hd: "neon_cabcdefghij_hd",
      sd: "neon_cabcdefghij_sd",
      live: "neon_cabcdefghij_live",
      liveHd: "neon_cabcdefghij_livehd",
    });
    for (const name of Object.values(names)) {
      assert.equal(isCameraId(name), true);
      assert.equal(ownStreamCamera(name), "cabcdefghij");
    }
    assert.equal(ownStreamCamera("front_door"), null);
    assert.equal(ownStreamCamera("neon_x_sd"), null);
  });

  it("reads a Camera Account over RTSP, video only and without two-way audio, the password encoded", () => {
    const sources = cameraSources(camera());
    assert.equal(sources.neon_cabcdefghij_hd, "rtsp://viewer:p%40ss%20word%231@192.168.1.21:554/stream1#media=video#backchannel=0");
    assert.equal(sources.neon_cabcdefghij_sd, "rtsp://viewer:p%40ss%20word%231@192.168.1.21:554/stream2#media=video#backchannel=0");
    // go2rtc refuses a source with a space in it, and reads a # as its own.
    for (const source of Object.values(sources)) assert.doesNotMatch(source, /\s/);
  });

  it("reads a Tapo login through go2rtc's tapo source, with the cloud password alone", () => {
    const sources = cameraSources(camera({ username: "owner@example.com", password: "cloud pass" }));
    assert.equal(sources.neon_cabcdefghij_hd, "tapo://cloud%20pass@192.168.1.21");
    assert.equal(sources.neon_cabcdefghij_sd, "tapo://cloud%20pass@192.168.1.21?subtype=1");
    assert.ok(!Object.values(sources).some((source) => source.includes("owner@example.com")), "the email is never sent anywhere");
    assert.equal(cameraPort("owner@example.com"), 8800);
    assert.equal(cameraPort("viewer"), 554);
  });

  it("makes the live pictures from the relay's own copy, the full one scaled and slowed", () => {
    const sources = cameraSources(camera());
    assert.equal(sources.neon_cabcdefghij_live, "ffmpeg:neon_cabcdefghij_sd#video=mjpeg");
    assert.equal(sources.neon_cabcdefghij_livehd, "ffmpeg:neon_cabcdefghij_hd#video=mjpeg/hd#width=1280");
    // The HD template lives in deploy/go2rtc/neon.yaml; without it the relay would stream at full size.
    const neon = readFileSync(join(process.cwd(), "deploy", "go2rtc", "neon.yaml"), "utf8");
    assert.match(neon, /mjpeg\/hd:/);
  });

  it("lists the hand-written cameras and never one of ours", () => {
    const read = manualStreams({
      "10_store": {},
      "2_studio": {},
      neon_cabcdefghij_sd: {},
      "rtsp://viewer:pw@192.168.1.40/stream1": {},
      "Front door": {},
    });
    assert.deepEqual(read, { keys: ["2_studio", "10_store"], skipped: ["rtsp://viewer:pw@192.168.1.40/stream1", "Front door"] });
    for (const body of [null, [], "streams", 3]) assert.equal(manualStreams(body), null);
  });

  it("asks for a stream by name, encoded, and refuses anything that is not one", () => {
    const base = "http://neon-cameras:1984";
    assert.equal(relayUrl(base, "frame", "neon_cabcdefghij_sd", 640), "http://neon-cameras:1984/api/frame.jpeg?src=neon_cabcdefghij_sd&width=640");
    assert.equal(relayUrl(base, "live", "مدخل_المكتب"), `http://neon-cameras:1984/api/stream.mjpeg?src=${encodeURIComponent("مدخل_المكتب")}`);
    assert.throws(() => relayUrl(base, "frame", "exec:reboot"));
    assert.throws(() => relayUrl(base, "live", "rtsp://evil/x"));
  });

  it("finds the relay on the Compose network unless told otherwise", () => {
    assert.equal(relayBase(undefined), DEFAULT_RELAY_URL);
    assert.equal(relayBase("http://127.0.0.1:1984/"), "http://127.0.0.1:1984");
    assert.equal(relayBase("ftp://127.0.0.1:1984"), DEFAULT_RELAY_URL);
    assert.equal(relayBase("not a url"), DEFAULT_RELAY_URL);
  });

  it("scales a snapshot only to a sensible width, and knows a JPEG and the live stream when it sees them", () => {
    assert.equal(snapshotWidth("640"), 640);
    for (const raw of [null, "", "100", "99999", "-1", "640.5", "640&src=rtsp://x"]) assert.equal(snapshotWidth(raw), null, String(raw));
    assert.equal(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), true);
    assert.equal(looksLikeJpeg(new Uint8Array()), false);
    assert.equal(isMjpegStream("multipart/x-mixed-replace; boundary=frame"), true);
    assert.equal(isMjpegStream("text/plain; charset=utf-8"), false);
    assert.equal(isMjpegStream(null), false);
  });
});

describe("why a camera sent no picture, in a sentence", () => {
  // go2rtc 1.9.14's own words for each case, as a relay said them.
  it("tells a refused account from an unreachable camera from a missing Camera Account", () => {
    assert.match(explainRelayError("streams: wrong user/pass", "camera-account", "192.168.1.21"), /refused the username or password.*Camera Account/);
    assert.match(explainRelayError("streams: wrong user/pass", "tapo-account", "192.168.1.21"), /refused the Tapo password/);
    assert.match(explainRelayError("streams: dial tcp 192.168.1.21:554: i/o timeout", "camera-account", "192.168.1.21"), /can't reach a camera at 192\.168\.1\.21/);
    assert.match(explainRelayError("streams: dial tcp 192.168.1.21:554: connect: connection refused", "camera-account", "192.168.1.21"), /isn't accepting video connections.*Camera Account/);
    assert.match(explainRelayError("streams: wrong response on DESCRIBE", "camera-account", "192.168.1.21"), /not with a camera's video/);
    assert.match(explainRelayError("streams: EOF", "camera-account", "192.168.1.21"), /closed the connection/);
    assert.match(explainRelayError("something new", "camera-account", "192.168.1.21"), /didn't send a picture/);
  });

  it("never repeats what the relay said, which can carry an address with a password", () => {
    const said = explainRelayError("streams: dial rtsp://viewer:hunter2@192.168.1.21:554: refused", "camera-account", "192.168.1.21");
    assert.ok(!said.includes("hunter2") && !said.includes("rtsp://"));
  });
});

describe("moving a camera", () => {
  it("turns the pad's directions into velocities: x pans right, y tilts up", () => {
    assert.deepEqual(DIRECTIONS.up, { x: 0, y: 1 });
    assert.deepEqual(DIRECTIONS.left, { x: -1, y: 0 });
  });

  it("holds a stick's velocity to −1…1 and treats a stick at rest as no move", () => {
    assert.deepEqual(velocity(0.5, "-0.25"), { x: 0.5, y: -0.25 });
    assert.deepEqual(velocity(3, -9), { x: 1, y: -1 });
    assert.equal(velocity(0.01, 0), null);
    assert.equal(velocity("x", 1), null);
    assert.equal(velocity(undefined, 1), null);
  });
});

describe("who may watch", () => {
  const asking = (token?: string) =>
    new Request("http://localhost/api/mobile/cameras/c/frame", token ? { headers: { authorization: `Bearer ${token}` } } : undefined);

  it("lets the manager through", () => {
    assert.equal(camerasGate(asking(createSessionToken())), null);
  });

  it("refuses somebody on the team with 403, which does not sign them out", async () => {
    const answer = camerasGate(asking(createEmployeeSessionToken("emp-1")));
    assert.equal(answer?.status, 403);
    assert.deepEqual(await answer?.json(), { error: CAMERA_ERRORS.managerOnly });
  });

  it("refuses no token, or a made-up one, with 401", () => {
    assert.equal(camerasGate(asking())?.status, 401);
    assert.equal(camerasGate(asking("1999999999999.deadbeef"))?.status, 401);
  });
});

// --- Against a stand-in for go2rtc ---------------------------------------------------

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0xff, 0xd9]);
const relay = { asked: [] as string[], streams: {} as Record<string, string>, liveClosed: 0, preloads: new Set<string>() };
let server: Server;

function answer(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://relay");
  relay.asked.push(`${request.method} ${url.pathname}?${url.searchParams.toString()}`);
  const src = url.searchParams.get("src") ?? "";

  if (url.pathname === "/api/streams") {
    if (request.method === "PATCH") {
      relay.streams[url.searchParams.get("name") ?? ""] = src;
      return response.end();
    }
    if (request.method === "DELETE") {
      delete relay.streams[src];
      // As go2rtc does for a stream that was never in its file, having dropped it anyway.
      response.statusCode = 400;
      return response.end("yaml: path not exist\n");
    }
    if (src) {
      response.statusCode = src === "neon_cabcdefghij_sd" ? 200 : 500;
      return response.end(src === "neon_cabcdefghij_sd" ? "{}" : "streams: wrong user/pass\n");
    }
    response.setHeader("content-type", "application/json");
    const listed = Object.fromEntries(Object.entries(relay.streams).map(([name, url]) => [name, { producers: [{ url }], consumers: null }]));
    return response.end(JSON.stringify(listed));
  }

  if (url.pathname === "/api/preload" && request.method === "PUT") {
    relay.preloads.add(src);
    return response.end();
  }

  if (url.pathname === "/api/frame.jpeg") {
    // As go2rtc does: a camera it cannot reach is an empty 200.
    if (src !== "neon_cabcdefghij_sd") return response.end();
    response.setHeader("content-type", "image/jpeg");
    return response.end(Buffer.from(JPEG));
  }

  if (url.pathname === "/api/stream.mjpeg") {
    if (src !== "neon_cabcdefghij_live") return response.end();
    response.setHeader("content-type", "multipart/x-mixed-replace; boundary=frame");
    const frame = () =>
      response.write(
        Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${JPEG.length}\r\n\r\n`), Buffer.from(JPEG), Buffer.from("\r\n")])
      );
    frame();
    const clock = setInterval(frame, 20);
    request.on("close", () => {
      clearInterval(clock);
      relay.liveClosed += 1;
    });
    return;
  }

  response.statusCode = 404;
  response.end();
}

async function until(check: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return true;
}

describe("talking to the relay, against a stand-in", () => {
  before(async () => {
    server = createServer(answer);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    process.env.CAMERAS_RELAY_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    delete process.env.CAMERAS_RELAY_URL;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it("registers a camera's streams by name and reads them back", async () => {
    for (const [name, source] of Object.entries(cameraSources(camera()))) assert.equal(await registerStream(name, source), true);
    const listed = await relayStreams();
    assert.deepEqual(Object.keys(listed ?? {}).sort(), Object.values(streamNames("cabcdefghij")).sort());
    assert.equal(await addPreload("neon_cabcdefghij_sd"), null);
    assert.ok(relay.preloads.has("neon_cabcdefghij_sd"));
  });

  it("refuses to register or ask for anything that is not a stream name", async () => {
    relay.asked = [];
    assert.equal(await registerStream("rtsp://x", "exec:reboot"), false);
    assert.deepEqual(await probeStream("exec:reboot"), { ok: false, error: "not a stream" });
    await removeStream("../../config");
    assert.deepEqual(relay.asked, []);
  });

  it("takes go2rtc's 400 on deleting a stream it never wrote down as done", async () => {
    await registerStream("neon_cabcdefghij_hd", "rtsp://a");
    await removeStream("neon_cabcdefghij_hd");
    assert.ok(!("neon_cabcdefghij_hd" in (relay.streams as Record<string, string>)));
  });

  it("hands go2rtc's reason back from a probe, for the sentence to be made from", async () => {
    assert.deepEqual(await probeStream("neon_cabcdefghij_sd"), { ok: true });
    assert.deepEqual(await probeStream("neon_cother00000_sd"), { ok: false, error: "streams: wrong user/pass" });
  });

  it("hands a snapshot on, and refuses go2rtc's empty answer for a camera it cannot reach", async () => {
    const signal = new AbortController().signal;
    const frame = await fetchFrame("neon_cabcdefghij_sd", 640, signal);
    assert.equal(frame.ok, true);
    if (frame.ok) assert.deepEqual([...frame.bytes], [...JPEG]);
    assert.ok(relay.asked.includes("GET /api/frame.jpeg?src=neon_cabcdefghij_sd&width=640"));
    assert.deepEqual(await fetchFrame("neon_cother00000_sd", null, signal), { ok: false, status: 502, error: CAMERA_ERRORS.noPicture });
  });

  it("passes the live stream through, and closes the relay's connection when the phone goes away", async () => {
    const phone = new AbortController();
    const live = await openLive("neon_cabcdefghij_live", phone.signal);
    assert.equal(live.ok, true);
    if (!live.ok) return;
    assert.equal(live.contentType, "multipart/x-mixed-replace; boundary=frame");

    const reader = live.body.getReader();
    const first = await reader.read();
    assert.ok(first.value && new TextDecoder().decode(first.value).startsWith("--frame"));

    const closedBefore = relay.liveClosed;
    phone.abort();
    assert.ok(await until(() => relay.liveClosed > closedBefore), "the relay's stream must be closed with the phone's");
    reader.releaseLock();
  });

  it("closes the relay's connection when the response itself is cancelled", async () => {
    const live = await openLive("neon_cabcdefghij_live", new AbortController().signal);
    assert.equal(live.ok, true);
    if (!live.ok) return;
    const closedBefore = relay.liveClosed;
    await live.body.cancel();
    assert.ok(await until(() => relay.liveClosed > closedBefore));
  });

  it("refuses a camera with no live picture rather than sending an empty stream", async () => {
    assert.deepEqual(await openLive("neon_cother00000_live", new AbortController().signal), { ok: false, status: 502, error: CAMERA_ERRORS.noLive });
  });

  it("reads a relay that is not there as down, not as an error", async () => {
    const was = process.env.CAMERAS_RELAY_URL;
    process.env.CAMERAS_RELAY_URL = "http://127.0.0.1:9";
    try {
      assert.equal(await relayStreams(), null);
      assert.deepEqual(await probeStream("neon_cabcdefghij_sd", 1000), { ok: false, error: "timeout" });
    } finally {
      process.env.CAMERAS_RELAY_URL = was;
    }
  });
});

describe("the routes and the registry", () => {
  const root = process.cwd();
  const read = (...path: string[]) => readFileSync(join(root, ...path), "utf8");
  const route = (kind: "frame" | "live") => read("src", "app", "api", "mobile", "cameras", "[id]", kind, "route.ts");

  it("check the manager before anything else on both picture routes", () => {
    for (const source of [route("frame"), route("live")]) {
      const body = source.slice(source.indexOf("export async function GET"));
      assert.match(body, /^export async function GET\([^)]*\)[^{]*\{\s*const refused = camerasGate\(request\);\s*if \(refused\) return refused;/);
    }
  });

  it("look the id up before asking the relay, and ask by the stream's own name", () => {
    for (const [source, call] of [
      [route("frame"), "fetchFrame("],
      [route("live"), "openLive("],
    ] as const) {
      assert.ok(source.indexOf("streamFor(") > 0 && source.indexOf("streamFor(") < source.indexOf(call), `${call} must come after streamFor`);
      assert.match(source, new RegExp(`${call.replace("(", "\\(")}found\\.name`));
    }
  });

  it("end the relay's live stream with the phone's request, and never cache or transform a picture", () => {
    assert.match(route("live"), /openLive\(found\.name, request\.signal\)/);
    assert.match(route("frame"), /"cache-control": "private, no-store/);
    assert.match(route("live"), /"cache-control": "no-store, no-transform"/);
  });

  it("keeps every camera read and action the manager's", () => {
    const source = read("src", "lib", "mobile", "registry", "cameras.ts");
    const entries = [...source.matchAll(/^ {2}"(cameras\/[^"]+)":\s*(\w+)\(requireAdmin,/gm)].map((match) => match[1]);
    assert.deepEqual(entries.sort(), [
      "cameras/delete",
      "cameras/goto",
      "cameras/list",
      "cameras/move",
      "cameras/presets",
      "cameras/save",
      "cameras/stop",
      "cameras/test",
    ]);
    assert.doesNotMatch(source, /requireStaff|requireEmployee/);
  });

  it("only ever sends a stored camera to the phone through viewOf", () => {
    const service = read("src", "lib", "mobile", "cameras-service.ts");
    assert.doesNotMatch(service, /return\s+\{[^}]*password/);
    assert.match(service, /camera: viewOf\(saved/);
  });
});
