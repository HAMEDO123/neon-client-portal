import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fillsWindow } from "../src/lib/full-window";

// Which pages own the window. Two shells read this — the admin shell decides
// whether the page scrolls or the page's own panes do, and LiveSync decides
// whether to refresh underneath it — and the failure when they disagree is
// silent either way.

describe("pages that own the window", () => {
  it("knows an open conversation, on either side", () => {
    for (const path of [
      "/admin/chat/team",
      "/admin/chat/cme123",
      "/employee/chat/manager",
      "/employee/chat/team/",
    ]) {
      assert.equal(fillsWindow(path), true, path);
    }
  });

  // A client's WhatsApp conversation opens inside the chat section, a segment
  // deeper. Left out of this, it would be refreshed underneath every couple of
  // seconds while somebody was typing an answer to a client.
  it("knows a client's WhatsApp conversation in the chat section", () => {
    assert.equal(fillsWindow("/admin/chat/wa/962790000001%40c.us"), true);
    assert.equal(fillsWindow("/employee/chat/wa/962790000001@c.us"), true);
    assert.equal(fillsWindow("/employee/chat/wa/1203630%40g.us/"), true);
  });

  it("knows the WhatsApp tab, on either side", () => {
    assert.equal(fillsWindow("/admin/whatsapp"), true);
    assert.equal(fillsWindow("/admin/whatsapp/"), true);
    assert.equal(fillsWindow("/employee/whatsapp"), true);
  });

  it("leaves ordinary pages alone", () => {
    // The list of conversations is a page like any other, and so is everything
    // that merely starts with the same word.
    for (const path of [
      "/admin",
      "/admin/chat",
      "/employee/chat",
      "/admin/settings",
      "/employee/tasks",
      "/admin/whatsapp/something",
      "/p/token-here",
    ]) {
      assert.equal(fillsWindow(path), false, path);
    }
  });
});
