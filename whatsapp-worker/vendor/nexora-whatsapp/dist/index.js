// One WhatsApp number, run properly.
//
// The four modules under src/ are the parts of NEXORA that were paid for in
// production incidents: a session layer that survives WhatsApp Web's habits, a
// send queue that will not get a number restricted, a memory of which numbers
// are reachable, and the official Cloud API for when a number matters too much
// to risk. They are independent of each other and of any framework — this file
// is the small amount of wiring that turns them into something you can use in
// an afternoon.
//
// Use the pieces directly if you want a different shape; nothing here is
// privileged, it is just the arrangement that works.
import { WhatsAppOutbox, fileOutboxJournal, memoryOutboxJournal, PermanentSendError, } from "./outbox.js";
import { checkReachable, recordSendFailure } from "./reachability.js";
import { getLocalLineStatus, hasSavedLocalLine, localSessionKey, parseLocalSessionKey, resumeSavedLocalLines, sendLocalLineText, sendLocalLineVoice, sendLocalLineMedia, setLocalSessionMessageHandler, setLocalSessionStatusListener, startLocalLine, stopLocalLine, isLocalLineWhatsAppNumber, } from "./session.js";
export * from "./outbox.js";
export * from "./reachability.js";
export * from "./session.js";
export * from "./cloud-api.js";
/**
 * A running WhatsApp setup: one or more linked numbers, and a queue in front
 * of them.
 *
 * Nothing sends directly. Every outbound message goes through the queue, which
 * is the whole point — see the outbox module's own notes for what it enforces
 * (a daily cap on new cold recipients, a pause between messages, one send per
 * idempotency key, a memory of numbers that permanently fail).
 */
export class WhatsApp {
    outbox;
    constructor(options = {}) {
        const journal = options.journalPath ? fileOutboxJournal(options.journalPath) : memoryOutboxJournal();
        this.outbox = new WhatsAppOutbox({
            now: () => Date.now(),
            journal,
            transport: this.buildTransport(),
            log: options.log,
        });
        if (options.onMessage) {
            const handler = options.onMessage;
            setLocalSessionMessageHandler((companyId, message, line) => {
                // Every real message carries words: typed text, or a voice note's
                // transcript. A content-free event is not a customer asking something.
                if (!message.body?.trim() && !message.isVoice)
                    return;
                void handler({ companyId, lineId: line.lineId, label: line.label }, message);
            });
        }
        if (options.onStatus) {
            const listener = options.onStatus;
            setLocalSessionStatusListener((sessionKey, snapshot) => listener(parseLocalSessionKey(sessionKey), snapshot));
        }
    }
    /**
     * The transport the queue sends through.
     *
     * The reachability gate in front of a non-reply is the expensive lesson: a
     * contact-existence lookup is scored by WhatsApp separately from messaging,
     * so it is memoised per number and skipped entirely for replies (whoever
     * just messaged you is demonstrably on WhatsApp). A lookup that cannot be
     * answered reads as "go ahead", never as "no" — the send-failure record
     * below is what catches a dead number in that case.
     */
    buildTransport() {
        return {
            lineReady: (lineKey) => getLocalLineStatus(lineKey).status === "connected",
            send: async (job) => {
                if (job.kind !== "reply") {
                    const verdict = await checkReachable({
                        lineKey: job.lineKey,
                        phone: job.to,
                        probe: (lineKey, phone) => isLocalLineWhatsAppNumber(lineKey, phone),
                    });
                    if (!verdict.reachable)
                        throw new PermanentSendError(verdict.reasonAr, "no_whatsapp_account");
                }
                try {
                    await sendLocalLineText(job.lineKey, job.to, job.text);
                    return { providerMessageId: null };
                }
                catch (err) {
                    const { permanent } = recordSendFailure(job.lineKey, job.to, err);
                    if (permanent) {
                        throw new PermanentSendError(`${job.to} has no WhatsApp account — no further attempts will be made (${err instanceof Error ? err.message : String(err)})`, "no_whatsapp_account");
                    }
                    throw err;
                }
            },
        };
    }
    /**
     * Links a number, or returns the state of one already linking.
     *
     * Give `phoneNumber` to link by an eight-character pairing code instead of a
     * QR image. Watch onStatus for the QR, the code, and the moment it connects.
     */
    link(line, phoneNumber) {
        return startLocalLine(line, phoneNumber ?? null);
    }
    /** Ends a line's session and forgets its login. */
    unlink(line) {
        return stopLocalLine(line);
    }
    status(line) {
        return getLocalLineStatus(line);
    }
    isLinked(line) {
        return hasSavedLocalLine(line);
    }
    /** Brings every saved login back up — call it once at startup. */
    resume() {
        return resumeSavedLocalLines();
    }
    /**
     * Queues a message. It is sent when the queue's own rules allow it.
     *
     * `kind` is the whole safety model, so choose it honestly:
     *   "reply"        — answering someone who wrote to you. No cap.
     *   "notification" — an update someone expects (an order, a booking).
     *   "cold"         — the first message to someone who never wrote to you.
     *                    Capped per number per day, because this is the one
     *                    that gets numbers banned.
     *
     * `idempotencyKey` names the business event, not the text — `order_12:ready`,
     * `followup_44`. Two calls carrying the same key are one send.
     */
    send(request) {
        return this.outbox.enqueue(request);
    }
    /** One message's state: queued, sending, sent, failed, dropped and why. */
    message(id) {
        return this.outbox.get(id);
    }
    /** What a number has left today: the backlog, and the remaining cold budget. */
    lineSnapshot(line) {
        return this.outbox.snapshot(typeof line === "string" ? line : localSessionKey(line));
    }
    /**
     * Lets the queue finish what it is holding before the process exits, and
     * says what it managed: how many it drained, how many were still in flight.
     */
    shutdown(drainMs = 2_000) {
        return this.outbox.shutdown(drainMs);
    }
    /** Media and voice go out directly — the queue carries text. */
    sendMediaNow = sendLocalLineMedia;
    sendVoiceNow = sendLocalLineVoice;
}
/** The usual way in. */
export function createWhatsApp(options = {}) {
    return new WhatsApp(options);
}
//# sourceMappingURL=index.js.map