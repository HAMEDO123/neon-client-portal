import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WhatsAppOutbox,
  memoryOutboxJournal,
  type OutboxRecord,
  type OutboxRecordView,
} from "../whatsapp-worker/vendor/nexora-whatsapp/dist/outbox.js";

// The queue does not run itself, and it does not read its own journal. Those
// are two separate gaps and the worker had both.
//
// `enqueue` records a message and returns; it reaches the transport only when
// something calls a pass. And a pass iterates the lines held in memory, which
// after a restart are none — the backlog is on disk until `restore()` reads it
// back. The worker called neither, so every message was accepted, journalled,
// answered 202, and forgotten. Nothing reports an error in that state: the send
// did not fail, it simply never happened.
//
// `pump()` and `restoreQueue()` on the library, plus the interval and the boot
// call in `whatsapp-worker/server.mjs`, are what close it. All of those are
// edits to vendored code that a re-vendor erases, so these tests are the
// tripwire.

function queueWith(sent: string[], lineReady = true, seed: OutboxRecord[] = []) {
  return new WhatsAppOutbox({
    now: () => Date.now(),
    journal: memoryOutboxJournal(seed),
    transport: {
      lineReady: () => lineReady,
      send: async (job: OutboxRecordView) => {
        sent.push(job.to);
      },
    },
  });
}

const message = {
  lineKey: "neon",
  companyId: "neon",
  to: "962790000000",
  text: "Your project is ready",
  kind: "notification",
} as const;

/** A message the previous process left waiting, as the journal holds it. */
function journalled(now: number): OutboxRecord {
  return {
    id: "wob_seeded_1",
    lineKey: "neon",
    companyId: "neon",
    installedEmployeeId: null,
    to: "962790000000",
    text: "Your project is ready",
    kind: "notification",
    idempotencyKey: "d:neon:962790000000:seeded",
    idempotencyExplicit: false,
    status: "queued",
    attempts: 0,
    enqueuedAt: now - 60_000,
    dueAt: now - 60_000,
    expiresAt: now + 60 * 60_000,
    lastAttemptAt: null,
    sentAt: null,
    providerMessageId: null,
    failureCode: null,
    failureReasonAr: null,
    lastErrorMessage: null,
    duplicateHits: 0,
    contextLabelAr: null,
    counterpartName: null,
  };
}

describe("the worker's send queue", () => {
  it("sends nothing until something pumps it", async () => {
    const sent: string[] = [];
    const queue = queueWith(sent);

    const queued = queue.enqueue({ ...message });

    // The state the bug left every real message in: accepted and durable, but
    // never handed to anything.
    assert.equal(queued.status, "queued");
    assert.deepEqual(sent, [], "enqueue must not reach the transport by itself");
    assert.equal(queue.get(queued.id)?.attempts, 0);

    await queue.tick();

    assert.deepEqual(sent, ["962790000000"], "a pass is what actually sends it");
    assert.equal(queue.get(queued.id)?.status, "sent");
  });

  it("defers while the line is down rather than spending an attempt", async () => {
    const sent: string[] = [];
    const queue = queueWith(sent, false);

    const queued = queue.enqueue({ ...message });
    await queue.tick();

    // A reconnecting session is not a failed message: it waits, and keeps its
    // attempts for real transport errors.
    assert.deepEqual(sent, []);
    const record = queue.get(queued.id);
    assert.equal(record?.status, "queued", "a disconnected line is not a failure");
    assert.equal(record?.attempts, 0, "waiting for the number is not an attempt");
  });

  it("cannot see a journalled backlog until the queue is restored", async () => {
    const sent: string[] = [];
    const queue = queueWith(sent, true, [journalled(Date.now())]);

    // Constructing the queue does not read the journal, so a pass has no lines
    // to iterate — the backlog exists on disk and nowhere else. This is the
    // half that survived the pump being added.
    await queue.tick();
    assert.deepEqual(queue.lineKeys(), [], "construction must not be mistaken for restoring");
    assert.deepEqual(sent, [], "a pass over no lines sends nothing");

    const restored = queue.restore();

    // Asserted on visibility rather than on an immediate send: restore()
    // deliberately holds a restarted backlog quiet for a moment so it does not
    // answer by bursting, and that pause is correct behaviour to leave alone.
    assert.equal(restored.requeued, 1, "the waiting message is taken back");
    assert.deepEqual(queue.lineKeys(), ["neon"], "restore is what makes a backlog reachable");
  });

  it("erases the backlog on shutdown when it was never restored", async () => {
    // This one cost four real messages, so it is pinned rather than described.
    //
    // shutdown() persists the queue as it stands in memory. A process that
    // never restored holds nothing, so persisting writes an EMPTY list over a
    // journal full of waiting messages — they are not sent, not expired, not
    // reported: they are deleted by the shutdown of a process that never knew
    // they existed. Restarting such a worker destroys its own backlog.
    const sent: string[] = [];
    const journal = memoryOutboxJournal([journalled(Date.now())]);
    const queue = new WhatsAppOutbox({
      now: () => Date.now(),
      journal,
      transport: {
        lineReady: () => true,
        send: async (job: OutboxRecordView) => {
          sent.push(job.to);
        },
      },
    });

    assert.equal(journal.records.length, 1);
    await queue.shutdown(0);
    assert.equal(journal.records.length, 0, "the unrestored backlog is written away");

    // Restoring first is the whole difference: the same shutdown now writes the
    // backlog back, and the message survives to be sent by the next process.
    const kept = memoryOutboxJournal([journalled(Date.now())]);
    const restored = new WhatsAppOutbox({
      now: () => Date.now(),
      journal: kept,
      transport: { lineReady: () => true, send: async () => {} },
    });

    restored.restore();
    await restored.shutdown(0);
    assert.equal(kept.records.length, 1, "a restored backlog survives a restart");
  });
});
