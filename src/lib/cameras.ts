// The studio's cameras: the pure part.
//
// The cameras are TP-Link Tapo units on the office network. The manager adds
// them from the phone — a name, the camera's IP address, a username and a
// password — and the list is kept in the database, sealed
// (lib/mobile/cameras-store.ts). A relay on the office PC — go2rtc, the
// `neon-cameras` service in docker-compose.yml — is told about each one at
// run time (lib/mobile/cameras-relay.ts) and turns its H.264 into JPEG
// snapshots and an MJPEG stream, which the site hands the phone
// (src/app/api/mobile/cameras/[id]/…). Pan and tilt go straight to the camera
// over ONVIF (lib/onvif.ts).
//
// This file is what can be decided without a network: what a camera id may
// look like, what a camera is called and what the phone is told about it, how
// a form is read, which addresses the relay is given, and what a failure means
// in a sentence.
//
// Three rules that hold everywhere:
//
//   - **A password never leaves the server.** The phone learns `hasPassword`;
//     the relay's own list — which carries every source address, password and
//     all — is read for its keys and nothing else.
//   - **Only names the server made, or the relay lists, are ever sent to the
//     relay.** go2rtc reads `src=` as a stream name *or a source to open*:
//     given `rtsp://…` or `ffmpeg:…` it connects to, or runs, whatever it was
//     handed. Every name is checked against CAMERA_ID_PATTERN and looked up
//     before it goes anywhere near the relay.
//   - **What a person typed is never a stream name.** Ids are made here
//     (`c` and ten random characters); the name somebody typed is only shown.

/** How a camera is signed in to: its own Camera Account, or the Tapo app's login (an email). */
export type CameraLogin = "camera-account" | "tapo-account";

/** One camera as it is kept — sealed — in the database. */
export type StoredCamera = {
  id: string;
  name: string;
  ip: string;
  username: string;
  password: string;
  /** Whether it answered ONVIF pan/tilt the last time it was tested; null untested. */
  ptz: boolean | null;
  addedAt: string;
};

/** What the phone is told about a camera. Never a password, never a source address. */
export type CameraView = {
  id: string;
  name: string;
  ip: string | null;
  username: string | null;
  hasPassword: boolean;
  /** null for a camera written into go2rtc.yaml on the office PC by hand. */
  login: CameraLogin | null;
  /** False for a hand-written one: the app can watch it but not change it. */
  editable: boolean;
  ptz: boolean | null;
  /** Whether the office PC could open a connection to it just now; null when not checked. */
  online: boolean | null;
};

export type CameraList = { cameras: CameraView[]; why: string | null; relay: "running" | "down" };

/** The result of trying a camera, said for the manager. */
export type CameraTest = { ok: boolean; message: string; ptz: boolean | null };

/**
 * A stream name the relay may be asked for: letters (any script), digits, `_`
 * and `-`, up to 64. Nothing in it can be read as an address, a path or a
 * query — no `:`, `/`, `.`, `?`, `#`, `%` or spaces. Server-made ids, the
 * relay's own names for them and the keys of a hand-written go2rtc.yaml all
 * fit; a source URL never does.
 */
export const CAMERA_ID_PATTERN = /^[\p{L}\p{N}_-]{1,64}$/u;

export function isCameraId(value: unknown): value is string {
  return typeof value === "string" && CAMERA_ID_PATTERN.test(value);
}

/** The ids this server makes: `c` and ten of [a-z0-9]. */
export const STORED_ID_PATTERN = /^c[a-z0-9]{10}$/;

export function newCameraIdFrom(random: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "c";
  for (let i = 0; i < 10; i++) id += alphabet[random[i] % alphabet.length];
  return id;
}

/** Every relay stream this server registers starts with this; anything else was written by hand. */
export const OWN_STREAM_PREFIX = "neon_";

/**
 * The four relay streams behind one camera: the camera's two qualities, and
 * the two MJPEG pictures go2rtc's ffmpeg makes from them for the phone.
 */
export function streamNames(id: string) {
  return {
    hd: `${OWN_STREAM_PREFIX}${id}_hd`,
    sd: `${OWN_STREAM_PREFIX}${id}_sd`,
    live: `${OWN_STREAM_PREFIX}${id}_live`,
    liveHd: `${OWN_STREAM_PREFIX}${id}_livehd`,
  };
}

/** The camera id a relay stream of ours belongs to, or null for a stream written by hand. */
export function ownStreamCamera(name: string): string | null {
  const match = /^neon_(c[a-z0-9]{10})_(hd|sd|live|livehd)$/.exec(name);
  return match ? match[1] : null;
}

export function loginOf(username: string): CameraLogin {
  return username.includes("@") ? "tapo-account" : "camera-account";
}

/**
 * Where the relay reads each stream from.
 *
 *   - **A Camera Account** (Tapo app → the camera → ⚙︎ → Advanced Settings →
 *     Camera Account) is RTSP on port 554: `stream1` is the camera's full
 *     picture, `stream2` its 640×360 one. Audio is left out (`#media=video`)
 *     and so is go2rtc's attempt at two-way audio (`#backchannel=0`), which
 *     costs a second handshake on every connection for nothing here.
 *   - **The Tapo app's own login** (an email) is go2rtc's native `tapo://`
 *     source on port 8800. It takes the *cloud password* alone — go2rtc signs
 *     in as the camera's admin with it — so the email itself is never sent;
 *     `?subtype=1` is the small picture.
 *
 * Both are percent-encoded, so a `#`, `@` or space in a password stays part of
 * the password (go2rtc refuses a source with a literal space in it).
 *
 * The MJPEG pair reads go2rtc's own copy of the camera, not the camera again:
 * the small picture as it comes, and the full one scaled to 1280 wide at ten
 * frames a second (`mjpeg/hd`, defined in deploy/go2rtc/neon.yaml) — the full
 * 2K picture as MJPEG would be tens of megabits, too much for a phone on a
 * mobile connection.
 */
export function cameraSources(camera: Pick<StoredCamera, "id" | "ip" | "username" | "password">) {
  const names = streamNames(camera.id);
  const ip = camera.ip;
  let hd: string;
  let sd: string;
  if (loginOf(camera.username) === "tapo-account") {
    const cloud = encodeURIComponent(camera.password);
    hd = `tapo://${cloud}@${ip}`;
    sd = `tapo://${cloud}@${ip}?subtype=1`;
  } else {
    const auth = `${encodeURIComponent(camera.username)}:${encodeURIComponent(camera.password)}`;
    hd = `rtsp://${auth}@${ip}:554/stream1#media=video#backchannel=0`;
    sd = `rtsp://${auth}@${ip}:554/stream2#media=video#backchannel=0`;
  }
  return {
    [names.hd]: hd,
    [names.sd]: sd,
    [names.live]: `ffmpeg:${names.sd}#video=mjpeg`,
    [names.liveHd]: `ffmpeg:${names.hd}#video=mjpeg/hd#width=1280`,
  } as Record<string, string>;
}

/** The port that says whether the camera is there at all. */
export function cameraPort(username: string): number {
  return loginOf(username) === "tapo-account" ? 8800 : 554;
}

/** Where a camera's ONVIF device service is: Tapo serves it on 2020. */
export function onvifAddress(ip: string): string {
  return `http://${ip}:2020/onvif/device_service`;
}

/** What the phone is told about a stored camera. */
export function viewOf(camera: StoredCamera, online: boolean | null = null): CameraView {
  return {
    id: camera.id,
    name: camera.name,
    ip: camera.ip,
    username: camera.username,
    hasPassword: camera.password.length > 0,
    login: loginOf(camera.username),
    editable: true,
    ptz: loginOf(camera.username) === "tapo-account" ? false : camera.ptz,
    online,
  };
}

/** What the phone is told about one written into go2rtc.yaml by hand. */
export function manualView(key: string): CameraView {
  return {
    id: key,
    name: cameraName(key),
    ip: null,
    username: null,
    hasPassword: false,
    login: null,
    editable: false,
    ptz: null,
    online: null,
  };
}

// --- What a camera is called ------------------------------------------------------

/**
 * A hand-written camera's name, from its key in go2rtc.yaml: an ordering
 * number at the front is dropped, underscores become spaces, and each word
 * starts with a capital.
 *
 *   front_door      → Front Door
 *   2_studio        → Studio          (the 2 only puts it second)
 *   مدخل_المكتب     → مدخل المكتب
 */
export function cameraName(id: string): string {
  const unordered = id.replace(/^\d+[_-]+(?=.)/u, "");
  const words = unordered.split("_").filter((word) => word.length > 0);
  if (words.length === 0) return id;
  return words
    .map((word) => {
      const [first, ...rest] = Array.from(word);
      return first.toLocaleUpperCase("en") + rest.join("");
    })
    .join(" ");
}

// Numbers in keys sort as numbers, so 2_studio comes before 10_store.
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Cameras in the order the grid shows them: by name, numbers read as numbers. */
export function sortCameras<T extends { name: string; id: string }>(cameras: T[]): T[] {
  return [...cameras].sort((a, b) => collator.compare(a.name, b.name) || collator.compare(a.id, b.id));
}

/**
 * The hand-written cameras in the relay's answer to `GET /api/streams`: its
 * keys that are not ours and look like a name. `skipped` are keys that are
 * not usable at all. Anything that is not a JSON object is not go2rtc, and
 * reads as `null`.
 */
export function manualStreams(body: unknown): { keys: string[]; skipped: string[] } | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  const keys: string[] = [];
  const skipped: string[] = [];
  for (const key of Object.keys(body)) {
    if (key.startsWith(OWN_STREAM_PREFIX)) continue;
    if (isCameraId(key)) keys.push(key);
    else skipped.push(key);
  }
  keys.sort((a, b) => collator.compare(a, b));
  return { keys, skipped };
}

/** Every stream name in the relay's answer, or null when it is not go2rtc's. */
export function streamKeys(body: unknown): Set<string> | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return new Set(Object.keys(body));
}

// --- Sentences --------------------------------------------------------------------

/** Said in place of the cameras, or above them. */
export const CAMERA_WHY = {
  relayDown: "The camera relay on the office PC isn't running.",
  noCameras: "The cameras aren't connected yet.",
  unreadable: "The saved cameras can't be read since the server's secret changed. Add them again.",
} as const;

export const CAMERA_ERRORS = {
  notFound: "There is no camera with that name.",
  noPicture: "The camera didn't send a picture.",
  noLive: "The camera isn't sending a live picture.",
  managerOnly: "Only the manager can watch the cameras.",
  noControls: "This camera can't be moved from here.",
  noAccountForControls: "Moving the camera needs its Camera Account, not the Tapo login.",
} as const;

/**
 * Why a camera did not send a picture, in a sentence for the manager, from
 * what the relay said when it tried (its error text never reaches the phone:
 * it can carry an address).
 */
export function explainRelayError(error: string, login: CameraLogin, ip: string): string {
  const text = error.toLowerCase();
  if (/wrong user|401|unauthori[sz]ed|403|forbidden/.test(text)) {
    return login === "tapo-account"
      ? "The camera refused the Tapo password. Check it, or use the camera's Camera Account instead."
      : "The camera refused the username or password. Use the Camera Account from the Tapo app (the camera → ⚙︎ → Advanced Settings → Camera Account), not the Tapo login.";
  }
  if (/i\/o timeout|timed out|timeout|no route to host|host is down|network is unreachable|deadline exceeded/.test(text)) {
    return `The office PC can't reach a camera at ${ip}. Check the address, and that the camera is on and connected to the office network.`;
  }
  if (/connection refused/.test(text)) {
    return login === "tapo-account"
      ? `The camera at ${ip} isn't accepting connections from the office PC. Try its Camera Account instead.`
      : `The camera at ${ip} isn't accepting video connections. Make sure it has a Camera Account in the Tapo app (the camera → ⚙︎ → Advanced Settings → Camera Account).`;
  }
  if (/describe|not found|404/.test(text)) {
    return `Something at ${ip} answered, but not with a camera's video. Check that it is the Tapo camera's address.`;
  }
  if (/eof|reset by peer|connection reset|broken pipe/.test(text)) {
    return "The camera closed the connection. It allows only a few viewers at once — close the Tapo app on other phones and try again.";
  }
  return "The camera didn't send a picture. Check the address, the account and that the camera is on.";
}

// --- Reading the add/edit form ------------------------------------------------------

export type CameraForm = { id: string | null; name: string; ip: string; username: string; password: string | null };

export type FormResult = { ok: true; form: CameraForm } | { ok: false; error: string };

const CONTROL = /[\u0000-\u001f\u007f]/;

/** An IPv4 address a camera on the office network can have. */
export function cameraIp(raw: string): string | null {
  const value = raw.trim();
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(value);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet, index) => octet > 255 || (match[index + 1].length > 1 && match[index + 1].startsWith("0")))) return null;
  const [a] = octets;
  // Nobody's camera: "this network", the relay's own loopback, multicast and above.
  if (a === 0 || a === 127 || a >= 224) return null;
  return octets.join(".");
}

/**
 * The add/edit form, as the phone posts it: `id` (editing), `name`, `ip`,
 * `username`, `password`. Editing with the password left empty keeps the
 * saved one, so `password` comes back null.
 */
export function readCameraForm(fields: Record<string, string | null | undefined>, editing: boolean): FormResult {
  const id = fields.id?.trim() || null;
  if (editing && !(id && STORED_ID_PATTERN.test(id))) return { ok: false, error: CAMERA_ERRORS.notFound };

  const name = (fields.name ?? "").trim().replace(/\s+/g, " ");
  if (!name) return { ok: false, error: "Give the camera a name." };
  if (name.length > 40 || CONTROL.test(name)) return { ok: false, error: "Keep the camera's name under 40 characters." };

  const ip = cameraIp(fields.ip ?? "");
  if (!ip) return { ok: false, error: "Type the camera's IP address, like 192.168.1.20." };

  const username = (fields.username ?? "").trim();
  if (!username || username.length > 64 || /\s/.test(username) || CONTROL.test(username)) {
    return { ok: false, error: "Type the Camera Account's username (or the Tapo app's email)." };
  }

  const typed = fields.password ?? "";
  if (typed.length > 128 || CONTROL.test(typed)) return { ok: false, error: "That password can't be right — check it and try again." };
  if (!typed && !editing) return { ok: false, error: "Type the password." };

  return { ok: true, form: { id: editing ? id : null, name, ip, username, password: typed || null } };
}

// --- Asking the relay -------------------------------------------------------------

/** Where the relay is: `CAMERAS_RELAY_URL`, or the Compose service by its name. */
export const DEFAULT_RELAY_URL = "http://neon-cameras:1984";

export function relayBase(raw: string | undefined): string {
  const value = raw?.trim();
  if (!value) return DEFAULT_RELAY_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return DEFAULT_RELAY_URL;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return DEFAULT_RELAY_URL;
  }
}

/** The relay's address for a snapshot or the live picture of one stream it already has. */
export function relayUrl(base: string, what: "streams" | "frame" | "live", name?: string, width?: number | null): string {
  if (what === "streams") return `${base}/api/streams`;
  if (!isCameraId(name)) throw new Error("Not a stream name.");
  const src = `src=${encodeURIComponent(name)}`;
  if (what === "live") return `${base}/api/stream.mjpeg?${src}`;
  return `${base}/api/frame.jpeg?${src}${width ? `&width=${width}` : ""}`;
}

/** `?width=` on a snapshot: a whole number of pixels the relay scales down to, or nothing. */
export function snapshotWidth(raw: string | null): number | null {
  if (!raw || !/^\d{2,4}$/.test(raw)) return null;
  const width = Number(raw);
  return width >= 160 && width <= 1920 ? width : null;
}

/** Whether these bytes are a JPEG at all — go2rtc answers an empty 200 when a camera can't be reached. */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

/** Whether a response is the MJPEG stream (go2rtc: `multipart/x-mixed-replace; boundary=frame`). */
export function isMjpegStream(contentType: string | null): boolean {
  return !!contentType && /^multipart\/x-mixed-replace\s*(;|$)/i.test(contentType.trim());
}

/**
 * A camera id from the route's `[id]`, or null. Next hands dynamic params
 * over decoded; one still percent-encoded (a proxy that encoded twice) is
 * decoded once more, and anything that does not then look like an id is not
 * one.
 */
export function cameraIdParam(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw;
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  value = value.normalize("NFC");
  return isCameraId(value) ? value : null;
}

// --- Moving it ---------------------------------------------------------------------

/** A direction the phone's pad sends, as an ONVIF velocity: x pans right, y tilts up. */
export const DIRECTIONS: Record<string, { x: number; y: number }> = {
  up: { x: 0, y: 1 },
  down: { x: 0, y: -1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  "up-left": { x: -0.7, y: 0.7 },
  "up-right": { x: 0.7, y: 0.7 },
  "down-left": { x: -0.7, y: -0.7 },
  "down-right": { x: 0.7, y: -0.7 },
};

/** A velocity the camera is sent: each axis held to −1…1, rounded, and nothing for a stick at rest. */
export function velocity(x: unknown, y: unknown): { x: number; y: number } | null {
  const read = (value: unknown) => {
    const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    return Number.isFinite(number) ? Math.max(-1, Math.min(1, Math.round(number * 100) / 100)) : null;
  };
  const vx = read(x);
  const vy = read(y);
  if (vx === null || vy === null) return null;
  if (Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) return null;
  return { x: vx, y: vy };
}
