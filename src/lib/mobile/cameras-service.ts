import crypto from "crypto";
import net from "net";
import {
  CAMERA_ERRORS,
  CAMERA_WHY,
  DIRECTIONS,
  OWN_STREAM_PREFIX,
  cameraPort,
  cameraSources,
  explainRelayError,
  loginOf,
  manualStreams,
  manualView,
  onvifAddress,
  ownStreamCamera,
  readCameraForm,
  sortCameras,
  streamKeys,
  streamNames,
  velocity,
  viewOf,
  type CameraList,
  type CameraTest,
  type CameraView,
  type StoredCamera,
} from "@/lib/cameras";
import { OnvifCamera, OnvifError, type OnvifPreset } from "@/lib/onvif";
import { RpcError, json } from "@/lib/mobile/rpc";
import { newCameraId, storedCamera, storedCameras, writeCameras } from "@/lib/mobile/cameras-store";
import {
  addPreload,
  fetchFrame,
  probeStream,
  registerStream,
  relayPreloads,
  relayStreams,
  removePreload,
  removeStream,
} from "@/lib/mobile/cameras-relay";

// The studio's cameras, end to end: the manager's list, adding, changing,
// removing and testing a camera, the stream behind a picture, and moving one.
// Every export here is reached only through a manager-only guard — the
// registry's requireAdmin (lib/mobile/registry/cameras.ts) or the picture
// routes' camerasGate.
//
// **The relay forgets; the database does not.** go2rtc is told about each
// camera at run time, and a restart of the relay forgets them all. So nothing
// here assumes it remembers: the list re-registers whatever is missing (and
// drops any of ours the database no longer has), and a picture asked for a
// camera the relay has forgotten registers it first.

const MAX_CAMERAS = 32;

// --- Keeping the relay in step with the database --------------------------------------

/** The relay's stream names, kept a few seconds: every snapshot checks them. */
let relayKnown: { at: number; keys: Set<string> | null } | null = null;
const RELAY_KNOWN_MS = 5_000;

async function relayKeys(fresh = false): Promise<Set<string> | null> {
  if (!fresh && relayKnown && Date.now() - relayKnown.at < RELAY_KNOWN_MS) return relayKnown.keys;
  const keys = streamKeys(await relayStreams());
  relayKnown = { at: Date.now(), keys };
  return keys;
}

/** When a camera's connection was last asked to be kept open; asked again at most this often. */
const preloadTried = new Map<string, number>();
const PRELOAD_RETRY_MS = 60_000;

function keepConnected(camera: StoredCamera, force = false) {
  const name = streamNames(camera.id).sd;
  const last = preloadTried.get(camera.id) ?? 0;
  if (!force && Date.now() - last < PRELOAD_RETRY_MS) return;
  preloadTried.set(camera.id, Date.now());
  // In the background: for a camera that is off, go2rtc spends its whole
  // connection timeout finding out, and nobody should wait on that.
  void (async () => {
    const kept = await relayPreloads();
    if (kept && !kept.has(name)) await addPreload(name);
  })();
}

/** Tells the relay about one camera: its four streams, and keeping it connected. */
async function register(camera: StoredCamera): Promise<boolean> {
  let all = true;
  for (const [name, source] of Object.entries(cameraSources(camera))) {
    all = (await registerStream(name, source)) && all;
  }
  relayKnown = null;
  keepConnected(camera, true);
  return all;
}

/**
 * Takes a camera off the relay. The preload goes first: a stream dropped with
 * its preload still attached would keep connecting to the camera, with the old
 * password, for nobody.
 */
async function unregister(id: string): Promise<void> {
  const names = streamNames(id);
  await removePreload(names.sd);
  for (const name of Object.values(names)) await removeStream(name);
  preloadTried.delete(id);
  relayKnown = null;
}

/** Registers a camera the relay has forgotten (it restarted). "down" when the relay cannot be reached. */
async function ensureRegistered(camera: StoredCamera): Promise<"ok" | "down"> {
  const keys = await relayKeys();
  if (!keys) return "down";
  const missing = Object.values(streamNames(camera.id)).some((name) => !keys.has(name));
  if (missing) await register(camera);
  else keepConnected(camera);
  return "ok";
}

/** Whether the office PC can open a connection to the camera at all, right now. */
function reachable(ip: string, port: number, timeoutMs = 1_200): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const done = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

// --- The list -------------------------------------------------------------------------

/**
 * Every camera, for the grid: the ones added in the app, then any written into
 * go2rtc.yaml by hand. Reading it also puts the relay back in step with the
 * database.
 */
export async function listCameras(): Promise<CameraList> {
  const [store, relay] = await Promise.all([storedCameras(), relayStreams()]);
  const keys = streamKeys(relay);
  relayKnown = { at: Date.now(), keys };

  if (keys && store.readable) {
    // Ours, for a camera the database no longer has (removed while the relay
    // was down): its password should not outlive it in the relay's memory.
    const stored = new Set(store.cameras.map((camera) => camera.id));
    const gone = new Set([...keys].map(ownStreamCamera).filter((owner): owner is string => owner !== null && !stored.has(owner)));
    for (const owner of gone) await unregister(owner);
    for (const camera of store.cameras) await ensureRegistered(camera);
  }

  const online = await Promise.all(store.cameras.map((camera) => reachable(camera.ip, cameraPort(camera.username))));
  const added = sortCameras(store.cameras.map((camera, index) => viewOf(camera, online[index])));
  const ids = new Set(added.map((camera) => camera.id));
  const byHand = (manualStreams(relay)?.keys ?? []).filter((key) => !ids.has(key)).map(manualView);
  const cameras = [...added, ...byHand];

  let why: string | null = null;
  if (!store.readable) why = CAMERA_WHY.unreadable;
  else if (cameras.length === 0) why = keys ? CAMERA_WHY.noCameras : CAMERA_WHY.relayDown;

  return { cameras, why, relay: keys ? "running" : "down" };
}

// --- The stream behind a picture -------------------------------------------------------

export type StreamLookup = { ok: true; name: string } | { ok: false; response: Response };

/**
 * The relay stream for a camera id from a phone: an added camera's own
 * (registered first if the relay has forgotten it), or a hand-written one the
 * relay lists. Never the phone's text itself unless the relay already has a
 * stream by exactly that name — so `src=` is always a name, never a source.
 */
export async function streamFor(id: string, want: "frame" | "live" | "live-hd"): Promise<StreamLookup> {
  const camera = await storedCamera(id);
  if (camera) {
    if ((await ensureRegistered(camera)) === "down") return { ok: false, response: json({ error: CAMERA_WHY.relayDown }, 503) };
    const names = streamNames(camera.id);
    return { ok: true, name: want === "frame" ? names.sd : want === "live" ? names.live : names.liveHd };
  }

  const keys = await relayKeys();
  if (!keys) return { ok: false, response: json({ error: CAMERA_WHY.relayDown }, 503) };
  const wanted = id.normalize("NFC");
  const key = [...keys].find((name) => !name.startsWith(OWN_STREAM_PREFIX) && name.normalize("NFC") === wanted);
  if (key) return { ok: true, name: key };
  return { ok: false, response: json({ error: CAMERA_ERRORS.notFound }, 404) };
}

// --- Adding, changing, removing, testing --------------------------------------------------

async function updateStored(id: string, change: (camera: StoredCamera) => StoredCamera) {
  const { cameras } = await storedCameras();
  if (!cameras.some((camera) => camera.id === id)) return;
  await writeCameras(cameras.map((camera) => (camera.id === id ? change(camera) : camera)));
}

/**
 * Tries a camera the way the app will use it: the relay connects to its small
 * picture, one snapshot comes back through ffmpeg, and — with a Camera Account
 * — ONVIF is asked whether it can pan and tilt. Answers in a sentence either
 * way; go2rtc's own words never reach the phone.
 */
export async function testCamera(id: string): Promise<CameraTest> {
  const camera = await storedCamera(id);
  if (!camera) throw new RpcError(CAMERA_ERRORS.notFound, 404);
  const login = loginOf(camera.username);

  if (!(await relayKeys(true))) return { ok: false, message: CAMERA_WHY.relayDown, ptz: camera.ptz };
  await register(camera);

  const names = streamNames(camera.id);
  const probe = await probeStream(names.sd);
  if (!probe.ok) return { ok: false, message: explainRelayError(probe.error, login, camera.ip), ptz: camera.ptz };

  const frame = await fetchFrame(names.sd, 640, AbortSignal.timeout(15_000));
  if (!frame.ok) {
    return { ok: false, message: "The camera answered, but no picture came through yet. Try again in a moment.", ptz: camera.ptz };
  }

  if (login === "tapo-account") {
    return {
      ok: true,
      message: "Connected — the picture is coming through. To move the camera from the app, use its Camera Account instead of the Tapo login.",
      ptz: false,
    };
  }

  let ptz: boolean | null = null;
  let note = "";
  try {
    forgetOnvif(camera.id);
    await onvifFor(camera).connect();
    ptz = true;
  } catch (error) {
    ptz = false;
    if (error instanceof OnvifError && error.kind === "not-authorized") {
      note = " It refused the Camera Account for moving, though — check the password.";
    }
  }
  if (ptz !== camera.ptz) await updateStored(camera.id, (stored) => ({ ...stored, ptz }));

  return {
    ok: true,
    message: ptz ? "Connected — the picture is coming through, and the camera can be moved from the app." : `Connected — the picture is coming through.${note}`,
    ptz,
  };
}

/**
 * Adds a camera, or changes one (`id`). Saved whether or not it then answers —
 * a camera that is off today is still the studio's camera — and tried at once,
 * so the app can say plainly what happened.
 */
export async function saveCamera(fields: Record<string, string | null | undefined>): Promise<{ camera: CameraView; test: CameraTest }> {
  const editing = Boolean(fields.id?.trim());
  const read = readCameraForm(fields, editing);
  if (!read.ok) throw new RpcError(read.error, read.error === CAMERA_ERRORS.notFound ? 404 : 400);
  const form = read.form;

  const store = await storedCameras();
  const others = store.cameras.filter((camera) => camera.id !== form.id);
  const twin = others.find((camera) => camera.ip === form.ip);
  if (twin) throw new RpcError(`There is already a camera at ${form.ip}: ${twin.name}.`, 409);

  let camera: StoredCamera;
  if (editing) {
    const existing = store.cameras.find((item) => item.id === form.id);
    if (!existing) throw new RpcError(CAMERA_ERRORS.notFound, 404);
    const password = form.password ?? existing.password;
    const changed = existing.ip !== form.ip || existing.username !== form.username || existing.password !== password;
    camera = { ...existing, name: form.name, ip: form.ip, username: form.username, password, ptz: changed ? null : existing.ptz };
    await writeCameras(store.cameras.map((item) => (item.id === camera.id ? camera : item)));
    if (changed) await unregister(camera.id);
  } else {
    if (store.cameras.length >= MAX_CAMERAS) throw new RpcError(`The studio can keep up to ${MAX_CAMERAS} cameras.`, 409);
    camera = {
      id: newCameraId(),
      name: form.name,
      ip: form.ip,
      username: form.username,
      password: form.password ?? "",
      ptz: null,
      addedAt: new Date().toISOString(),
    };
    await writeCameras([...store.cameras, camera]);
  }
  forgetOnvif(camera.id);

  const test = await testCamera(camera.id);
  const saved = (await storedCamera(camera.id)) ?? camera;
  return { camera: viewOf(saved, test.ok ? true : null), test };
}

export async function deleteCamera(id: string): Promise<void> {
  const store = await storedCameras();
  if (!store.cameras.some((camera) => camera.id === id)) throw new RpcError(CAMERA_ERRORS.notFound, 404);
  await writeCameras(store.cameras.filter((camera) => camera.id !== id));
  forgetOnvif(id);
  // If the relay is down now, the list removes these the next time it is read.
  await unregister(id);
}

// --- Moving it -------------------------------------------------------------------------------

const onvifHeld = new Map<string, { onvif: OnvifCamera; fingerprint: string; at: number }>();
const ONVIF_KEEP_MS = 10 * 60_000;

function fingerprint(camera: StoredCamera): string {
  return crypto.createHash("sha256").update(`${camera.ip}\n${camera.username}\n${camera.password}`).digest("hex");
}

function onvifFor(camera: StoredCamera): OnvifCamera {
  const print = fingerprint(camera);
  const held = onvifHeld.get(camera.id);
  if (held && held.fingerprint === print && Date.now() - held.at < ONVIF_KEEP_MS) return held.onvif;
  const onvif = new OnvifCamera(onvifAddress(camera.ip), camera.username, camera.password);
  onvifHeld.set(camera.id, { onvif, fingerprint: print, at: Date.now() });
  return onvif;
}

function forgetOnvif(id: string) {
  onvifHeld.delete(id);
}

async function movable(id: string): Promise<StoredCamera> {
  const camera = await storedCamera(id);
  if (!camera) throw new RpcError(CAMERA_ERRORS.notFound, 404);
  if (loginOf(camera.username) === "tapo-account") throw new RpcError(CAMERA_ERRORS.noAccountForControls, 409);
  return camera;
}

function refusal(error: unknown, id: string): never {
  forgetOnvif(id);
  if (error instanceof OnvifError) {
    if (error.kind === "no-ptz") throw new RpcError(CAMERA_ERRORS.noControls, 409);
    if (error.kind === "not-authorized") throw new RpcError("The camera refused its Camera Account. Check the password.", 409);
    if (error.kind === "unreachable") throw new RpcError("The camera didn't answer. Check that it is on.", 502);
    throw new RpcError("The camera didn't take that. Try again.", 502);
  }
  throw error;
}

/**
 * What the live view can offer: whether this camera moves, and its saved
 * positions. A camera that does not move — or answers nothing on ONVIF — is
 * simply `canMove: false`, and the app draws no controls.
 */
export async function cameraControls(id: string): Promise<{ canMove: boolean; presets: OnvifPreset[]; why: string | null }> {
  const camera = await storedCamera(id);
  if (!camera) return { canMove: false, presets: [], why: null };
  if (loginOf(camera.username) === "tapo-account") return { canMove: false, presets: [], why: CAMERA_ERRORS.noAccountForControls };

  const onvif = onvifFor(camera);
  try {
    await onvif.connect();
  } catch (error) {
    forgetOnvif(camera.id);
    if (error instanceof OnvifError && error.kind === "no-ptz" && camera.ptz !== false) {
      await updateStored(camera.id, (stored) => ({ ...stored, ptz: false }));
    }
    const why = error instanceof OnvifError && error.kind === "not-authorized" ? "The camera refused its Camera Account for moving." : null;
    return { canMove: false, presets: [], why };
  }
  if (camera.ptz !== true) await updateStored(camera.id, (stored) => ({ ...stored, ptz: true }));

  let presets: OnvifPreset[] = [];
  try {
    presets = (await onvif.presets()).slice(0, 16);
  } catch {
    // Moving works without them.
  }
  return { canMove: true, presets, why: null };
}

/** Each camera's pending stop: a move is never left running because a release was lost. */
const stopTimers = new Map<string, ReturnType<typeof setTimeout>>();
const MOVE_SECONDS = 1;
const AUTO_STOP_MS = 1_200;

/**
 * Starts the camera turning — a direction from the pad ("up", "down-left" …)
 * or an x/y velocity from the stick — for a second at most. The app sends it
 * again while a finger is held down and `stop` when it lifts; if that never
 * arrives, the camera's own timeout and a stop from here both end it.
 */
export async function moveCamera(id: string, how: { direction?: string | null; x?: unknown; y?: unknown; speed?: unknown }) {
  const camera = await movable(id);
  let v: { x: number; y: number } | null;
  if (how.direction) {
    const base = DIRECTIONS[how.direction];
    if (!base) throw new RpcError("That is not a direction.");
    const speed = velocity(how.speed ?? 1, 0)?.x ?? 1;
    v = velocity(base.x * Math.abs(speed), base.y * Math.abs(speed));
  } else {
    v = velocity(how.x, how.y);
  }
  if (!v) return stopCamera(id);

  try {
    await onvifFor(camera).move(v.x, v.y, MOVE_SECONDS);
  } catch (error) {
    refusal(error, camera.id);
  }
  clearTimeout(stopTimers.get(camera.id));
  stopTimers.set(
    camera.id,
    setTimeout(() => {
      stopTimers.delete(camera.id);
      onvifFor(camera)
        .stop()
        .catch(() => {});
    }, AUTO_STOP_MS)
  );
  return { moving: v };
}

export async function stopCamera(id: string) {
  const camera = await movable(id);
  clearTimeout(stopTimers.get(camera.id));
  stopTimers.delete(camera.id);
  try {
    await onvifFor(camera).stop();
  } catch (error) {
    refusal(error, camera.id);
  }
  return { moving: null };
}

export async function gotoPreset(id: string, preset: string) {
  const camera = await movable(id);
  if (!/^[\w.-]{1,64}$/.test(preset)) throw new RpcError("That is not one of the camera's positions.");
  try {
    await onvifFor(camera).gotoPreset(preset);
  } catch (error) {
    refusal(error, camera.id);
  }
  return { preset };
}
