import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { chatCopy, chatPreview } from "../src/lib/notifications/types";

// What a chat message says on a lock screen — the same shorthand WhatsApp
// uses, so a photo or a voice note reads as one at a glance.

describe("a chat message on the lock screen", () => {
  it("shows text as it was written", () => {
    assert.equal(chatPreview("TEXT", "On my way to site"), "On my way to site");
  });

  it("says how long a voice message is", () => {
    assert.equal(chatPreview("VOICE", null, 12), "🎤 Voice message (0:12)");
    assert.equal(chatPreview("VOICE", null, 75), "🎤 Voice message (1:15)");
    assert.equal(chatPreview("VOICE", null, null), "🎤 Voice message");
  });

  it("marks a photo, with its caption when it has one", () => {
    assert.equal(chatPreview("IMAGE", null), "📷 Photo");
    assert.equal(chatPreview("IMAGE", "Ceiling is done"), "📷 Ceiling is done");
  });

  it("names a file by its file name", () => {
    assert.equal(chatPreview("FILE", null, null, "Electrical plans.pdf"), "📄 Electrical plans.pdf");
    assert.equal(chatPreview("FILE", null), "📄 File");
  });

  it("puts the sender's name on top and the message beneath", () => {
    const copy = chatCopy("Manager", chatPreview("IMAGE", "Ceiling is done"));
    assert.equal(copy.title, "Manager");
    assert.equal(copy.message, "📷 Ceiling is done");
  });
});
