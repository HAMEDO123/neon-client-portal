import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  adminChatUrl,
  channelKeyOf,
  conversationFromKey,
  conversationSlug,
  employeeChatUrl,
  groupChannelKey,
  groupIdFromSlug,
  groupSlug,
  isGroupConversation,
  mayOpen,
  parseConversation,
  peerConversation,
  type ChatViewer,
  type Conversation,
} from "../src/lib/chat-conversations";
import { GROUP_NAME_MAX, cleanGroupName, groupAvatar, readMemberIds } from "../src/lib/chat-groups";
import { mayCallIn } from "../src/lib/calls";

const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
const wael: ChatViewer = { type: "EMPLOYEE", id: "cmwael00000000000000", name: "Wael" };
const sally: ChatViewer = { type: "EMPLOYEE", id: "cmsally0000000000000", name: "Sally" };

const groupId = "cmgroup000000000000a";
const group: Conversation = { kind: "group", groupId };

describe("who may open a group", () => {
  it("lets the manager into every group, member rows or not", () => {
    assert.equal(mayOpen(manager, group), true);
    assert.equal(mayOpen(manager, group, []), true);
  });

  it("lets an employee in only when they are a member", () => {
    assert.equal(mayOpen(wael, group, [wael.id]), true);
    assert.equal(mayOpen(sally, group, [wael.id]), false);
    assert.equal(mayOpen(wael, group, []), false);
  });

  it("keeps an employee out when nobody said who is in it", () => {
    assert.equal(mayOpen(wael, group), false);
    assert.equal(mayOpen(wael, group, null), false);
  });

  it("changes nothing for the other kinds of conversation", () => {
    assert.equal(mayOpen(wael, { kind: "team" }, []), true);
    assert.equal(mayOpen(manager, peerConversation(wael.id, sally.id), [wael.id]), false);
  });
});

describe("naming a group", () => {
  it("reads g-<id> from both sides as the same group", () => {
    assert.deepEqual(parseConversation(`g-${groupId}`, manager), group);
    assert.deepEqual(parseConversation(`g-${groupId}`, wael), group);
  });

  it("names it back the same way from both sides", () => {
    assert.equal(conversationSlug(group, manager), `g-${groupId}`);
    assert.equal(conversationSlug(group, wael), `g-${groupId}`);
    assert.equal(groupSlug(groupId), `g-${groupId}`);
    assert.equal(groupIdFromSlug(`g-${groupId}`), groupId);
  });

  it("refuses a slug that names no group", () => {
    assert.equal(parseConversation("g-", wael), null);
    assert.equal(parseConversation("g-../../etc", manager), null);
    assert.equal(parseConversation("g-a:b", wael), null);
    assert.equal(groupIdFromSlug("team"), null);
  });

  it("never mistakes a group's slug for an employee's id, or the other way round", () => {
    assert.deepEqual(parseConversation(wael.id, manager), { kind: "direct", employeeId: wael.id });
    assert.equal(parseConversation(`g-${groupId}`, manager)?.kind, "group");
  });

  it("keys its channel grp:<id>, and reads the key back", () => {
    assert.equal(groupChannelKey(groupId), `grp:${groupId}`);
    assert.deepEqual(conversationFromKey(`grp:${groupId}`), group);
    assert.equal(conversationFromKey("grp:"), null);
    assert.equal(channelKeyOf(group), `grp:${groupId}`);
  });

  it("gives each kind its channel key back", () => {
    for (const conversation of [
      { kind: "team" } as Conversation,
      { kind: "direct", employeeId: wael.id } as Conversation,
      peerConversation(wael.id, sally.id),
      group,
    ]) {
      assert.deepEqual(conversationFromKey(channelKeyOf(conversation)), conversation);
    }
  });

  it("links each side to its own portal", () => {
    assert.equal(employeeChatUrl(group, wael.id), `/employee/chat/g-${groupId}`);
    assert.equal(adminChatUrl(group), `/admin/chat/g-${groupId}`);
  });

  it("is a group, like the team, and calls work in it", () => {
    assert.equal(isGroupConversation(group), true);
    assert.equal(isGroupConversation({ kind: "team" }), true);
    assert.equal(isGroupConversation({ kind: "direct", employeeId: wael.id }), false);
    assert.equal(mayCallIn(group), true);
  });
});

describe("making a group", () => {
  it("needs a name, tidied and cut to length", () => {
    assert.equal(cleanGroupName("  Site   team "), "Site team");
    assert.throws(() => cleanGroupName("   "), /name/);
    assert.throws(() => cleanGroupName(undefined), /name/);
    assert.equal(cleanGroupName("x".repeat(200)).length, GROUP_NAME_MAX);
  });

  it("reads people from repeated fields or one comma-joined field, once each", () => {
    assert.deepEqual(readMemberIds(["a", "b"]), ["a", "b"]);
    assert.deepEqual(readMemberIds(["a, b,,c", "a"]), ["a", "b", "c"]);
    assert.deepEqual(readMemberIds([]), []);
    assert.deepEqual(readMemberIds([3, null]), []);
  });

  it("wears its photo, else the studio's mark", () => {
    assert.equal(groupAvatar("https://x/y.jpg"), "https://x/y.jpg");
    assert.equal(groupAvatar(null), "/admin-icon-192.png");
  });
});
