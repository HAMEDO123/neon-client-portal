import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_AFTER_MS,
  arrivalCopy,
  arrivalKey,
  chatTitle,
  inboxUrl,
  look,
  readInboxSummary,
  readWatchState,
  whatsAppPreview,
  type WatchedChat,
} from "../src/lib/whatsapp-watch";

// Noticing that somebody wrote to the studio's WhatsApp, and telling the team.
// The two ways this goes wrong are both loud — announcing fifty old chats to
// every phone the first time it runs, or the same message every minute — so
// both are pinned here.

const NOW = Date.parse("2026-10-06T10:00:00Z");
const minutesAgo = (m: number) => NOW - m * 60_000;

const chat = (over: Partial<WatchedChat> & { last?: Partial<NonNullable<WatchedChat["lastMessage"]>> | null } = {}): WatchedChat => {
  const { last, ...rest } = over;
  return {
    id: "962790000001@c.us",
    name: "Abu Mohammad",
    number: "962790000001",
    isGroup: false,
    unreadCount: 1,
    archived: false,
    timestamp: minutesAgo(1),
    lastMessage:
      last === null ? null : { body: "مرحبا، بدي أسأل عن التصميم", fromMe: false, type: "chat", timestamp: minutesAgo(1), ...last },
    ...rest,
  };
};

const watching = { since: minutesAgo(60), seen: {} as Record<string, number> };

describe("the first look", () => {
  // Fifty old conversations landing on every phone at once is what would get
  // this switched off on its first day.
  it("records where things stand and announces nothing", () => {
    const first = look([chat(), chat({ id: "b@c.us" })], null, NOW);
    assert.deepEqual(first.arrivals, []);
    assert.equal(first.next.since, NOW);
  });

  it("then announces only what arrives after it", () => {
    const first = look([chat({ last: { timestamp: minutesAgo(5) } })], null, minutesAgo(3));
    const second = look([chat({ last: { timestamp: minutesAgo(1) } })], first.next, NOW);
    assert.equal(second.arrivals.length, 1);
  });
});

describe("what counts as news", () => {
  it("is a message the other side sent, newer than anything already said", () => {
    const { arrivals, next } = look([chat()], watching, NOW);
    assert.equal(arrivals.length, 1);
    assert.equal(arrivals[0].title, "Abu Mohammad");
    assert.equal(arrivals[0].preview, "مرحبا، بدي أسأل عن التصميم");
    assert.equal(next.seen["962790000001@c.us"], minutesAgo(1));
  });

  // The same message, a minute later: nothing has happened.
  it("is said once, however many times it is looked at", () => {
    const once = look([chat()], watching, NOW);
    const again = look([chat()], once.next, NOW + 60_000);
    assert.deepEqual(again.arrivals, []);
    // …and what was said is not forgotten by a look that found nothing.
    assert.equal(again.next.seen["962790000001@c.us"], minutesAgo(1));
  });

  it("is said again when they write again", () => {
    const once = look([chat()], watching, NOW);
    const later = look([chat({ last: { body: "؟", timestamp: NOW + 30_000 } })], once.next, NOW + 60_000);
    assert.equal(later.arrivals.length, 1);
    assert.equal(later.arrivals[0].preview, "؟");
  });

  it("is never our own message", () => {
    assert.deepEqual(look([chat({ last: { fromMe: true } })], watching, NOW).arrivals, []);
  });

  // A group renamed, the encryption banner, our own automatic greeting.
  it("is never one of WhatsApp's own notices", () => {
    for (const type of ["gp2", "e2e_notification", "notification_template", "automated_greeting_message", "revoked"]) {
      assert.deepEqual(look([chat({ last: { type } })], watching, NOW).arrivals, [], type);
    }
  });

  // Somebody archived it on the handset: they decided not to be shown it.
  // Recorded all the same, so un-archiving does not bring old news back.
  it("is not announced for an archived chat, and is not announced later either", () => {
    const archived = look([chat({ archived: true })], watching, NOW);
    assert.deepEqual(archived.arrivals, []);
    assert.deepEqual(look([chat({ archived: false })], archived.next, NOW + 60_000).arrivals, []);
  });

  // The worker was down overnight: a message from yesterday is not news now.
  it("is not announced once it is old, and does not come back", () => {
    const old = chat({ last: { timestamp: NOW - STALE_AFTER_MS - 60_000 } });
    const state = { since: NOW - 2 * STALE_AFTER_MS, seen: {} };
    const seen = look([old], state, NOW);
    assert.deepEqual(seen.arrivals, []);
    assert.deepEqual(look([old], seen.next, NOW + 60_000).arrivals, []);
  });

  it("ignores status broadcasts and channels", () => {
    assert.deepEqual(look([chat({ id: "status@broadcast" }), chat({ id: "123@newsletter" })], watching, NOW).arrivals, []);
  });

  it("says a photo or a voice note as what it is", () => {
    assert.equal(look([chat({ last: { body: "", type: "image" } })], watching, NOW).arrivals[0].preview, "Photo");
    assert.equal(look([chat({ last: { body: "", type: "ptt" } })], watching, NOW).arrivals[0].preview, "Voice note");
    assert.equal(whatsAppPreview({ body: "  ", type: "call_log" }), "Call");
  });

  it("puts several arrivals in the order they were sent", () => {
    const { arrivals } = look(
      [chat({ id: "late@c.us", last: { timestamp: minutesAgo(1) } }), chat({ id: "early@c.us", last: { timestamp: minutesAgo(4) } })],
      watching,
      NOW
    );
    assert.deepEqual(arrivals.map((arrival) => arrival.chatId), ["early@c.us", "late@c.us"]);
  });
});

describe("who it is from", () => {
  it("uses the name, then the number, and never an empty title", () => {
    assert.equal(chatTitle({ name: "Abu Mohammad", number: "962790000001", isGroup: false }), "Abu Mohammad");
    assert.equal(chatTitle({ name: "  ", number: "962790000001", isGroup: false }), "+962790000001");
    assert.equal(chatTitle({ name: null, number: null, isGroup: true }), "A group");
    assert.equal(chatTitle({ name: null, number: null, isGroup: false }), "Unknown number");
  });
});

describe("the row in the chat list", () => {
  it("counts the chats with something unread, a marked-unread one included", () => {
    const { summary } = look(
      [chat({ unreadCount: 3 }), chat({ id: "b@c.us", unreadCount: -1 }), chat({ id: "c@c.us", unreadCount: 0 })],
      watching,
      NOW
    );
    assert.equal(summary.unreadChats, 2);
  });

  it("shows the newest message, ours or theirs", () => {
    const { summary } = look(
      [chat({ last: { timestamp: minutesAgo(9) } }), chat({ id: "b@c.us", name: "Supplier", last: { body: "تم", fromMe: true, timestamp: minutesAgo(2) } })],
      watching,
      NOW
    );
    assert.deepEqual(summary.latest, { title: "Supplier", preview: "تم", at: minutesAgo(2), fromMe: true });
  });

  it("survives being stored and read back, and anything unreadable is nothing", () => {
    const { summary } = look([chat()], watching, NOW);
    assert.deepEqual(readInboxSummary(JSON.stringify(summary)), summary);
    assert.equal(readInboxSummary("not json"), null);
    assert.equal(readInboxSummary(null), null);
  });
});

describe("what is kept between looks", () => {
  it("reads back what it wrote", () => {
    const { next } = look([chat()], watching, NOW);
    assert.deepEqual(readWatchState(JSON.stringify(next)), next);
  });

  // Unreadable is "never looked": the next look is a first look, which
  // announces nothing. The other reading would announce everything.
  it("treats anything unreadable as never having looked", () => {
    assert.equal(readWatchState("{"), null);
    assert.equal(readWatchState(JSON.stringify({ seen: {} })), null);
    assert.equal(readWatchState(""), null);
  });
});

describe("saying it", () => {
  const arrival = { chatId: "962790000001@c.us", title: "Abu Mohammad", preview: "مرحبا", at: minutesAgo(1), unread: 1, isGroup: false };

  // On a lock screen the first thing to know is that this is a client writing
  // to the studio, not a colleague.
  it("names WhatsApp first, then who", () => {
    assert.deepEqual(arrivalCopy(arrival), { title: "WhatsApp · Abu Mohammad", message: "مرحبا" });
  });

  it("says how many are waiting when it is more than one", () => {
    assert.equal(arrivalCopy({ ...arrival, unread: 5 }).message, "مرحبا (5 unread)");
  });

  it("keeps a long message to what a lock screen shows", () => {
    assert.ok(arrivalCopy({ ...arrival, preview: "x".repeat(400) }).message.length <= 140);
  });

  it("is keyed to the person, the chat and the message, so it is said once each", () => {
    assert.equal(arrivalKey(arrival, "wael"), `WHATSAPP:962790000001@c.us:${minutesAgo(1)}:wael`);
    assert.notEqual(arrivalKey(arrival, "wael"), arrivalKey(arrival, "sally"));
    assert.notEqual(arrivalKey(arrival, "wael"), arrivalKey({ ...arrival, at: NOW }, "wael"));
  });

  // The manager is turned away by the employee portal, and the reverse: a
  // notification that opens onto a refusal reads as a broken platform.
  it("opens on the right side, on the chat it is about", () => {
    assert.equal(inboxUrl("employee", "a@c.us"), "/employee/whatsapp?chat=a%40c.us");
    assert.equal(inboxUrl("admin", "a@c.us"), "/admin/whatsapp?chat=a%40c.us");
    assert.equal(inboxUrl("employee"), "/employee/whatsapp");
  });
});

// A look that nobody runs announces nothing, and nothing would say so: the
// inbox would still open, the row would still draw, and clients would simply
// stop being heard about. So the wiring is pinned as well as the rule.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CRON_JOBS } from "../src/lib/status";

describe("the look is actually run", () => {
  const read = (...parts: string[]) => readFileSync(join(process.cwd(), ...parts), "utf8").replace(/\r\n/g, "\n");

  it("every minute, by the scheduler that runs the minute's jobs", () => {
    assert.match(read("docker-compose.yml"), /for job in meetings clock location[^;]*\bwhatsapp\b[^;]*; do/);
  });

  it("as a job the endpoint knows by name", () => {
    assert.ok((CRON_JOBS as readonly string[]).includes("whatsapp"));
    assert.match(read("src", "app", "api", "cron", "notifications", "route.ts"), /forced === "whatsapp" \|\| !forced/);
  });
});
