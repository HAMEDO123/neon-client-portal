import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STALE_AFTER_MS,
  arrivalCopy,
  arrivalKey,
  chatFromRow,
  chatIdFromSegment,
  chatTitle,
  inboxRows,
  inboxUrl,
  look,
  mergeChatList,
  readInboxSummary,
  readWatchState,
  rowPreview,
  whatsAppChatUrl,
  whatsAppPreview,
  type InboxRow,
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

// The studio asked for the clients to be in the same chat list as the team, a
// row each. These are the rows, and the order the two kinds of row are put in.
describe("a row for each client", () => {
  it("is every open conversation, newest first", () => {
    const rows = inboxRows([
      chat({ id: "old@c.us", name: "Old", last: { timestamp: minutesAgo(90) } }),
      chat({ id: "new@c.us", name: "New", unreadCount: 3, last: { body: "صورة", timestamp: minutesAgo(2) } }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["new@c.us", "old@c.us"]
    );
    assert.deepEqual(rows[0], {
      id: "new@c.us",
      title: "New",
      preview: "صورة",
      at: minutesAgo(2),
      unread: 3,
      fromMe: false,
      isGroup: false,
    });
  });

  // Put away on the handset is put away here; a status broadcast was never a
  // conversation; and a chat with nothing in it has no line to show.
  it("leaves out what is archived, what is not a conversation, and what is empty", () => {
    const rows = inboxRows([
      chat({ id: "a@c.us", archived: true }),
      chat({ id: "status@broadcast" }),
      chat({ id: "news@newsletter" }),
      chat({ id: "empty@c.us", last: null }),
      chat({ id: "kept@c.us" }),
    ]);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["kept@c.us"]
    );
  });

  it("carries the most recent and no more", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      chat({ id: `${index}@c.us`, last: { timestamp: minutesAgo(index + 1) } })
    );
    const rows = inboxRows(many, 5);
    assert.deepEqual(
      rows.map((row) => row.id),
      ["0@c.us", "1@c.us", "2@c.us", "3@c.us", "4@c.us"]
    );
  });

  it("says what was sent when there are no words, and whose line it is", () => {
    const [voice] = inboxRows([chat({ last: { body: "", type: "ptt" } })]);
    assert.equal(voice.preview, "Voice note");
    assert.equal(rowPreview({ preview: "تم", fromMe: true }), "You: تم");
    assert.equal(rowPreview({ preview: "مرحبا", fromMe: false }), "مرحبا");
  });

  it("travels with the summary, and a damaged row costs that row only", () => {
    const { summary } = look([chat(), chat({ id: "b@c.us" })], watching, NOW);
    assert.equal(summary.rows.length, 2);

    const stored = JSON.parse(JSON.stringify(summary));
    stored.rows[0] = { title: "no id" };
    assert.equal(readInboxSummary(JSON.stringify(stored))?.rows.length, 1);
    // A summary from before rows were kept simply has none.
    delete stored.rows;
    assert.deepEqual(readInboxSummary(JSON.stringify(stored))?.rows, []);
  });
});

describe("one list, the team and the clients together", () => {
  const at = (minutes: number) => new Date(minutesAgo(minutes));
  const team = (slug: string, last: Date | null, pinned = false) => ({ slug, pinned, last: last ? { createdAt: last } : null });
  const client = (id: string, minutes: number): InboxRow => ({
    id,
    title: id,
    preview: "",
    at: minutesAgo(minutes),
    unread: 0,
    fromMe: false,
    isGroup: false,
  });
  const names = (entries: ReturnType<typeof mergeChatList<ReturnType<typeof team>>>) =>
    entries.map((entry) => (entry.kind === "chat" ? entry.item.slug : `wa:${entry.row.id}`));

  it("is in order of who wrote last, whichever kind of chat it is", () => {
    const merged = mergeChatList(
      [team("team", at(5)), team("wael", at(40))],
      [client("abu", 1), client("supplier", 20), client("old", 300)]
    );
    assert.deepEqual(names(merged), ["wa:abu", "team", "wa:supplier", "wael", "wa:old"]);
  });

  // A WhatsApp chat cannot be pinned here, so nothing of it may land above
  // what somebody chose to keep at the top.
  it("keeps what the viewer pinned above everything, as it was", () => {
    const merged = mergeChatList([team("pinned", at(500), true), team("team", at(5))], [client("abu", 1)]);
    assert.deepEqual(names(merged), ["pinned", "wa:abu", "team"]);
  });

  // A colleague nobody has written to yet has no time to be sorted by. They
  // stay where they always were — after everything that has been said — and
  // a client's old chat does not fall below them.
  it("leaves colleagues nobody has written to yet at the end", () => {
    const merged = mergeChatList([team("new-colleague", null), team("team", at(5))], [client("abu", 900)]);
    assert.deepEqual(names(merged), ["team", "wa:abu", "new-colleague"]);
  });

  it("is the list it was given when there is no WhatsApp", () => {
    const items = [team("a", at(1), true), team("b", at(2)), team("c", null)];
    assert.deepEqual(names(mergeChatList(items, [])), ["a", "b", "c"]);
  });
});

describe("opening a client's conversation", () => {
  it("lives in the chat section, on the right side", () => {
    assert.equal(whatsAppChatUrl("employee", "962790000001@c.us"), "/employee/chat/wa/962790000001%40c.us");
    assert.equal(whatsAppChatUrl("admin", "1203630@g.us"), "/admin/chat/wa/1203630%40g.us");
  });

  // Whether the framework hands the segment over decoded or not must not
  // decide whether the chat is found.
  it("reads the id back out of the address either way", () => {
    assert.equal(chatIdFromSegment("962790000001%40c.us"), "962790000001@c.us");
    assert.equal(chatIdFromSegment("962790000001@c.us"), "962790000001@c.us");
    assert.equal(chatIdFromSegment("%E0%A4%A"), "%E0%A4%A");
  });

  it("can be opened by its id alone, when the list no longer carries it", () => {
    assert.deepEqual(chatFromRow("962790000001@c.us", null), {
      id: "962790000001@c.us",
      name: null,
      number: "962790000001",
      isGroup: false,
    });
    assert.equal(chatFromRow("1203630@g.us", null).isGroup, true);
    // A @lid chat's first part is not a number anybody dials.
    assert.equal(chatFromRow("27483530960@lid", null).number, null);
  });

  it("takes its name from the row when there is one", () => {
    const row: InboxRow = { id: "a@c.us", title: "Abu Mohammad", preview: "", at: NOW, unread: 0, fromMe: false, isGroup: false };
    assert.equal(chatFromRow("a@c.us", row).name, "Abu Mohammad");
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
  // The stored link stays the WhatsApp tab's: the phone app reads these paths,
  // and the tab passes `?chat=` on to the conversation in the chat section.
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

  // A link in a notification that the tab swallowed would open the whole inbox
  // instead of the one chat it was about.
  it("and a link to one chat is passed on to that conversation", () => {
    for (const side of ["admin/(dashboard)", "employee/(portal)"]) {
      assert.match(read("src", "app", ...side.split("/"), "whatsapp", "page.tsx"), /redirect\(whatsAppChatUrl\(/, side);
    }
  });

  it("as a job the endpoint knows by name", () => {
    assert.ok((CRON_JOBS as readonly string[]).includes("whatsapp"));
    assert.match(read("src", "app", "api", "cron", "notifications", "route.ts"), /forced === "whatsapp" \|\| !forced/);
  });
});
