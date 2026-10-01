import crypto from "crypto";
import { getSetting, setSetting } from "@/lib/settings";
import { open, seal } from "@/lib/secret-box";
import { STORED_ID_PATTERN, cameraIp, newCameraIdFrom, type StoredCamera } from "@/lib/cameras";

// The studio's cameras, kept in the database: one settings row, the whole list
// sealed (lib/secret-box.ts — the same lock as the office shop's session), so
// a copy of the database — the daily dumps leave this machine — carries no
// camera password. It protects a copy and nothing more: the server opens it to
// register the cameras with the relay. The phone never sees a password back
// (lib/cameras.ts `viewOf`).
//
// Opening it derives a key with scrypt, which is slow on purpose, and the grid
// asks for a snapshot every two seconds per camera — so the opened list is
// kept in memory for a moment and replaced whenever it is written.
//
// Not "use server": every export of one of those is callable over the network.

const KEY = "cameras";
const KEEP_MS = 30_000;

let held: { at: number; read: StoredCameras } | null = null;

export type StoredCameras = {
  cameras: StoredCamera[];
  /** False when something is stored that cannot be opened — SESSION_SECRET changed since. */
  readable: boolean;
};

function valid(item: unknown): item is StoredCamera {
  if (typeof item !== "object" || item === null) return false;
  const camera = item as Record<string, unknown>;
  return (
    typeof camera.id === "string" &&
    STORED_ID_PATTERN.test(camera.id) &&
    typeof camera.name === "string" &&
    typeof camera.ip === "string" &&
    cameraIp(camera.ip) !== null &&
    typeof camera.username === "string" &&
    typeof camera.password === "string"
  );
}

export async function storedCameras(): Promise<StoredCameras> {
  if (held && Date.now() - held.at < KEEP_MS) return held.read;

  const sealed = await getSetting(KEY);
  let read: StoredCameras;
  if (!sealed) {
    read = { cameras: [], readable: true };
  } else {
    const plain = open(sealed);
    let cameras: StoredCamera[] | null = null;
    if (plain) {
      try {
        const parsed = JSON.parse(plain) as unknown;
        if (Array.isArray(parsed)) {
          cameras = parsed.filter(valid).map((camera) => ({
            ...camera,
            ptz: typeof camera.ptz === "boolean" ? camera.ptz : null,
            addedAt: typeof camera.addedAt === "string" ? camera.addedAt : new Date(0).toISOString(),
          }));
        }
      } catch {
        cameras = null;
      }
    }
    read = cameras ? { cameras, readable: true } : { cameras: [], readable: false };
  }
  held = { at: Date.now(), read };
  return read;
}

export async function storedCamera(id: string): Promise<StoredCamera | null> {
  return (await storedCameras()).cameras.find((camera) => camera.id === id) ?? null;
}

export async function writeCameras(cameras: StoredCamera[]): Promise<void> {
  await setSetting(KEY, seal(JSON.stringify(cameras)));
  held = { at: Date.now(), read: { cameras, readable: true } };
}

export function newCameraId(): string {
  return newCameraIdFrom(crypto.randomBytes(10));
}
