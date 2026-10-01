import { requireAdmin } from "@/lib/admin-guard";
import {
  cameraControls,
  deleteCamera,
  gotoPreset,
  listCameras,
  moveCamera,
  saveCamera,
  stopCamera,
  testCamera,
} from "@/lib/mobile/cameras-service";
import { guarded, guardedAction, param, str, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";

// The "cameras" area of the phone API: the studio's CCTV, the manager's alone.
// See lib/cameras.ts for the whole picture. Keys are "cameras/<name>"; every
// read and every action is behind requireAdmin — somebody on the team gets
// 403 — and the pictures themselves come from their own routes,
// /api/mobile/cameras/<id>/frame and …/live, behind the same rule.
//
// Nothing here ever answers with a password: a camera reaches the phone as
// `{ id, name, ip, username, hasPassword, login, editable, ptz, online }`.

/** The add/edit form's own fields, and nothing else from it. */
function cameraFields(form: FormData): Record<string, string | null> {
  const field = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : null;
  };
  return { id: field("id"), name: field("name"), ip: field("ip"), username: field("username"), password: field("password") };
}

export const reads: ReadRegistry = {
  // { cameras: CameraView[], why: string | null, relay: "running" | "down" }
  "cameras/list": guarded(requireAdmin, async () => listCameras()),

  // ?id= → { canMove, presets: [{ token, name }], why }
  "cameras/presets": guarded(requireAdmin, async (params) => cameraControls(param(params, "id"))),
};

export const actions: ActionRegistry = {
  // form { id?, name, ip, username, password } — an empty password keeps the
  // saved one → { camera: CameraView, test: { ok, message, ptz } }
  "cameras/save": guardedAction(requireAdmin, async ({ form }) => saveCamera(cameraFields(form))),

  // args [id]
  "cameras/delete": guardedAction(requireAdmin, async ({ args }) => deleteCamera(str(args[0], "id"))),

  // args [id] → { ok, message, ptz }
  "cameras/test": guardedAction(requireAdmin, async ({ args }) => testCamera(str(args[0], "id"))),

  // args [id, direction, speed?] ("up", "down-left" …) or [id, x, y] (−1…1)
  "cameras/move": guardedAction(requireAdmin, async ({ args }) => {
    const id = str(args[0], "id");
    if (typeof args[1] === "string" && !/^-?[\d.]+$/.test(args[1])) {
      return moveCamera(id, { direction: args[1], speed: args[2] });
    }
    return moveCamera(id, { x: args[1], y: args[2] });
  }),

  // args [id]
  "cameras/stop": guardedAction(requireAdmin, async ({ args }) => stopCamera(str(args[0], "id"))),

  // args [id, presetToken]
  "cameras/goto": guardedAction(requireAdmin, async ({ args }) => gotoPreset(str(args[0], "id"), str(args[1], "preset"))),
};
