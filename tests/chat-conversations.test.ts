import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  chatSide,
  conversationSlug,
  employeeChatUrl,
  isConversationPath,
  listTime,
  mayOpen,
  parseConversation,
  previewLine,
  type ChatViewer,
} from "../src/lib/chat-conversations";

const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
const wael: ChatViewer = { type: "EMPLOYEE", id: "cmwael00000000000000", name: "Wael" };
const sally: ChatViewer = { type: "EMPLOYEE", id: "cmsally0000000000000", name: "Sally" };

describe("who may open a conversation", () => {
  it("lets everyone into the team", () => {
    for (const viewer of [manager, wael, sally]) assert.equal(mayOpen(viewer, { kind: "team" }), true);
  });

  it("lets an employee into their own private chat, and nobody else's", () => {
    assert.equal(mayOpen(wael, { kind: "direct", employeeId: wael.id }), true);
    assert.equal(mayOpen(wael, { kind: "direct", employeeId: sally.id }), false);
  });

  it("lets the manager into every private chat", () => {
    assert.equal(mayOpen(manager, { kind: "direct", employeeId: wael.id }), true);
    assert.equal(mayOpen(manager, { kind: "direct", employeeId: sally.id }), true);
  });
});

describe("naming a conversation", () => {
  it("reads the team, the manager, and an employee", () => {
    assert.deepEqual(parseConversation("team", wael), { kind: "team" });
    assert.deepEqual(parseConversation("manager", wael), { kind: "direct", employeeId: wael.id });
    assert.deepEqual(parseConversation(sally.id, manager), { kind: "direct", employeeId: sally.id });
  });

  it("gives an employee no way to name somebody else's chat", () => {
    assert.equal(parseConversation(sally.id, wael), null);
    assert.equal(parseConversation("manager", manager), null);
    assert.equal(parseConversation("../../etc/passwd", manager), null);
    assert.equal(parseConversation("", wael), null);
    assert.equal(parseConversation(null, wael), null);
  });

  it("names it back from each side", () => {
    const direct = { kind: "direct", employeeId: wael.id } as const;
    assert.equal(conversationSlug(direct, wael), "manager");
    assert.equal(conversationSlug(direct, manager), wael.id);
    assert.equal(conversationSlug({ kind: "team" }, sally), "team");
    assert.equal(employeeChatUrl(direct), "/employee/chat/manager");
    assert.equal(employeeChatUrl({ kind: "team" }), "/employee/chat/team");
  });

  it("tells an open conversation from the list of them", () => {
    assert.equal(isConversationPath("/employee/chat/team"), true);
    assert.equal(isConversationPath("/admin/chat/cmwael00000000000000"), true);
    assert.equal(isConversationPath("/employee/chat"), false);
    assert.equal(isConversationPath("/admin/chat"), false);
    assert.equal(isConversationPath("/admin/tasks"), false);
  });
});

describe("the chat list", () => {
  const zone = "Asia/Amman";
  // 15:00 on Thursday 10 September in Amman.
  const now = new Date("2026-09-10T12:00:00Z");
  // Newer ICU puts a narrow space before AM/PM.
  const plain = (text: string) => text.replace(/\s/g, " ");

  it("writes the time today, Yesterday, the weekday, then the date", () => {
    assert.equal(plain(listTime(new Date("2026-09-10T06:30:00Z"), now, zone)), "9:30 AM");
    assert.equal(listTime(new Date("2026-09-09T10:00:00Z"), now, zone), "Yesterday");
    assert.equal(listTime(new Date("2026-09-07T10:00:00Z"), now, zone), "Monday");
    assert.equal(listTime(new Date("2026-08-20T10:00:00Z"), now, zone), "20 Aug");
  });

  it("goes by the company's day, not the server's", () => {
    // 22:30 on the 9th in UTC is already half past one on the 10th in Amman.
    assert.equal(plain(listTime(new Date("2026-09-09T22:30:00Z"), now, zone)), "1:30 AM");
  });

  it("previews the last message the way WhatsApp does", () => {
    const last = {
      kind: "TEXT" as const,
      body: "On site now",
      durationSeconds: null,
      attachmentName: null,
      authorName: "Wael",
      mine: false,
      createdAt: now,
    };
    assert.equal(previewLine(last, true), "Wael: On site now");
    assert.equal(previewLine(last, false), "On site now");
    assert.equal(previewLine({ ...last, mine: true }, true), "You: On site now");
    assert.equal(previewLine({ ...last, kind: "VOICE", body: null, durationSeconds: 65 }, false), "🎤 Voice message (1:05)");
    assert.equal(previewLine(null, true), null);
  });
});

describe("which portal is asking", () => {
  it("reads the two sides, and nothing else", () => {
    assert.equal(chatSide("ADMIN"), "ADMIN");
    assert.equal(chatSide("EMPLOYEE"), "EMPLOYEE");
    assert.equal(chatSide("admin"), undefined);
    assert.equal(chatSide("MANAGER"), undefined);
    assert.equal(chatSide(""), undefined);
    assert.equal(chatSide(null), undefined);
  });
});
