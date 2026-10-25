import { requireStaff } from "@/lib/admin-guard";
import { guarded, guardedAction, param, RpcError, str, type ActionRegistry, type ReadRegistry } from "@/lib/mobile/rpc";
import { readWalkieSeconds, readWalkieTarget } from "@/lib/walkie";
import { leaveWalkie, markWalkieHeard, sayOnWalkie, speakerRow, walkieAllowed, walkieLatest, walkieOpenForSpeaker, walkiePeople, walkieThread } from "@/lib/walkie-store";

// The "walkie" area of the phone API: the studio's walkie-talkie
// (lib/walkie.ts). The manager and the team alike. See lib/mobile/rpc.ts: keys
// are "walkie/<name>".

export const reads: ReadRegistry = {
  // Who the signed-in person can talk to — the manager as "admin", and the
  // team — never themselves, whether it may speak right now, and for each
  // conversation (and "all") when it last spoke and how much of theirs is unheard.
  // → { open, people: [{ id, name, role, photoUrl, manager, allowed, lastAt, unheard }],
  //     all: { lastAt, unheard } }
  "walkie/people": guarded(requireStaff, async (_params, who) => {
    const latest = await walkieLatest(who);
    const people = await walkiePeople(who);
    return {
      open: await walkieOpenForSpeaker(who),
      people: people.map((person) => ({
        ...person,
        lastAt: latest.get(person.id)?.lastAt ?? null,
        unheard: latest.get(person.id)?.unheard ?? 0,
      })),
      all: { lastAt: latest.get("all")?.lastAt ?? null, unheard: 0 },
    };
  }),

  // One conversation, oldest first (?with= "all" | "admin" | employeeId).
  // → { items: [{ id, mine, fromName, scope, audioUrl, seconds, at, phones, heardAt,
  //     recipients?: [{ key, phones, heardAt }] }] }
  "walkie/thread": guarded(requireStaff, async (params, who) => ({
    items: await walkieThread(who, param(params, "with")),
  })),

  // This phone's owner: whether they have it on, and that it is required.
  // → { allowed, required, open }
  "walkie/me": guarded(requireStaff, async (_params, who) => ({
    allowed: await walkieAllowed(await speakerRow(who)),
    required: who.type === "EMPLOYEE",
    open: await walkieOpenForSpeaker(who),
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
      // The hours no longer close it — outside them it narrows to one person
      // talking to one person, so each refusal says which half was missing.
      if (outcome.reason === "night-all") {
        throw new RpcError("After 7 PM the walkie-talkie is one to one. Choose a person rather than everybody.", 409);
      }
      if (outcome.reason === "night-speaker") {
        throw new RpcError("The walkie-talkie is yours from 10 AM to 7 PM.", 409);
      }
      if (outcome.reason === "night-listener") {
        throw new RpcError("After 7 PM you can only reach the people the studio allows at night.", 409);
      }
      if (outcome.reason === "not-found") throw new RpcError("There is nobody to talk to there.", 404);
      if (outcome.reason === "nobody") throw new RpcError("Nobody there has the walkie-talkie on yet.", 409);
      throw new RpcError("iPhone push isn't set up on the server, so nothing can reach a phone.", 503);
    }
    return { batch: outcome.batch, heard: outcome.heard, notOn: outcome.notOn, phones: outcome.phones };
  }),

  // This phone has played it (args [messageId]): the speaker sees "heard".
  "walkie/heard": guardedAction(requireStaff, async (input, who) => ({
    heard: await markWalkieHeard(who, str(input.args[0], "id")),
  })),

  // Turned off on this phone (args [token?]); without a token, on every phone.
  "walkie/leave": guardedAction(requireStaff, async (input, who) => {
    const row = await speakerRow(who);
    const token = typeof input.args[0] === "string" && input.args[0] ? input.args[0] : null;
    if (row) await leaveWalkie(row, token);
    return { allowed: await walkieAllowed(row) };
  }),
};
