import { requireStaff } from "@/lib/admin-guard";
import { guarded, guardedAction, RpcError, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";
import { readWalkieSeconds, readWalkieTarget } from "@/lib/walkie";
import { leaveWalkie, sayOnWalkie, speakerRow, walkieAllowed, walkieOpen, walkiePeople } from "@/lib/walkie-store";

// The "walkie" area of the phone API: the studio's walkie-talkie
// (lib/walkie.ts). The manager and the team alike. See lib/mobile/rpc.ts: keys
// are "walkie/<name>".

export const reads: ReadRegistry = {
  // Who the signed-in person can talk to — the manager as "admin", and the
  // team — never themselves, and whether it may speak right now.
  // → { open, people: [{ id, name, role, photoUrl, manager, allowed }] }
  "walkie/people": guarded(requireStaff, async (_params, who) => ({
    open: await walkieOpen(),
    people: await walkiePeople(who),
  })),

  // This phone's owner: whether they have it on, and that it is required.
  // → { allowed, required, open }
  "walkie/me": guarded(requireStaff, async (_params, who) => ({
    allowed: await walkieAllowed(await speakerRow(who)),
    required: who.type === "EMPLOYEE",
    open: await walkieOpen(),
  })),
};

export const actions: ActionRegistry = {
  // Says it. args ["all" | "admin" | employeeId], multipart `audio` (the
  // recording) and `seconds?`. → { heard: [names], notOn: [names], phones }
  "walkie/send": guardedAction(requireStaff, async (input, who) => {
    const target = readWalkieTarget(input.args[0]);
    if (!target) throw new RpcError("Choose who to talk to.");
    const voice = input.form.get("audio");
    if (!(voice instanceof File) || voice.size === 0) throw new RpcError("Nothing was recorded.");

    const outcome = await sayOnWalkie({ speaker: who, target, voice, seconds: readWalkieSeconds(input.form.get("seconds")) });
    if (!outcome.ok) {
      if (outcome.reason === "closed") throw new RpcError("The walkie-talkie works from 10 AM to 4 AM.", 409);
      if (outcome.reason === "not-found") throw new RpcError("There is nobody to talk to there.", 404);
      if (outcome.reason === "nobody") throw new RpcError("Nobody there has the walkie-talkie on yet.", 409);
      throw new RpcError("iPhone push isn't set up on the server, so nothing can reach a phone.", 503);
    }
    return { heard: outcome.heard, notOn: outcome.notOn, phones: outcome.phones };
  }),

  // Turned off on this phone (args [token?]); without a token, on every phone.
  "walkie/leave": guardedAction(requireStaff, async (input, who) => {
    const row = await speakerRow(who);
    const token = typeof input.args[0] === "string" && input.args[0] ? input.args[0] : null;
    if (row) await leaveWalkie(row, token);
    return { allowed: await walkieAllowed(row) };
  }),
};
