import { type EnqueueResult, type OutboxDeps, type OutboxRecordView, type OutboxSendRequest } from "./outbox.js";
import { sendLocalLineVoice, sendLocalLineMedia, type LocalIncomingMessage, type LocalLine, type LocalSessionSnapshot } from "./session.js";
export * from "./outbox.js";
export * from "./reachability.js";
export * from "./session.js";
export * from "./cloud-api.js";
/** A message worth answering: someone said something, and it was not us. */
export type IncomingMessage = LocalIncomingMessage;
export type WhatsAppOptions = {
    /**
     * Where the queue's journal lives. A path survives restarts — messages
     * waiting when the process died are still waiting when it comes back.
     * Omit it and the queue is memory-only, which is fine for tests and wrong
     * for production.
     */
    journalPath?: string;
    /**
     * Called for every real inbound message. Messages from your own number are
     * already filtered out by the session, and messages carrying no words at
     * all are filtered out here: WhatsApp delivers content-free events —
     * most visibly under its @lid addressing, where the sender has no phone
     * number either — and answering one sends an unprompted message to someone
     * who never wrote to you. That is how a number gets reported.
     */
    onMessage?: (line: LocalLine, message: IncomingMessage) => void | Promise<void>;
    /** Called whenever a line's status changes: the QR to show, connected, error. */
    onStatus?: (line: LocalLine, snapshot: LocalSessionSnapshot) => void;
    /** Log destination. Defaults to console. */
    log?: OutboxDeps["log"];
};
/**
 * A running WhatsApp setup: one or more linked numbers, and a queue in front
 * of them.
 *
 * Nothing sends directly. Every outbound message goes through the queue, which
 * is the whole point — see the outbox module's own notes for what it enforces
 * (a daily cap on new cold recipients, a pause between messages, one send per
 * idempotency key, a memory of numbers that permanently fail).
 */
export declare class WhatsApp {
    private readonly outbox;
    constructor(options?: WhatsAppOptions);
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
    private buildTransport;
    /**
     * Links a number, or returns the state of one already linking.
     *
     * Give `phoneNumber` to link by an eight-character pairing code instead of a
     * QR image. Watch onStatus for the QR, the code, and the moment it connects.
     */
    link(line: LocalLine, phoneNumber?: string): Promise<LocalSessionSnapshot>;
    /** Ends a line's session and forgets its login. */
    unlink(line: LocalLine): Promise<void>;
    status(line: LocalLine): LocalSessionSnapshot;
    isLinked(line: LocalLine): boolean;
    /** Brings every saved login back up — call it once at startup. */
    resume(): Promise<string[]>;
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
    send(request: OutboxSendRequest): EnqueueResult;
    /** One message's state: queued, sending, sent, failed, dropped and why. */
    message(id: string): OutboxRecordView | null;
    /** What a number has left today: the backlog, and the remaining cold budget. */
    lineSnapshot(line: LocalLine | string): import("./outbox.js").OutboxLineSnapshot;
    /**
     * Lets the queue finish what it is holding before the process exits, and
     * says what it managed: how many it drained, how many were still in flight.
     */
    shutdown(drainMs?: number): Promise<{
        drained: number;
        stillSending: number;
    }>;
    /** Media and voice go out directly — the queue carries text. */
    sendMediaNow: typeof sendLocalLineMedia;
    sendVoiceNow: typeof sendLocalLineVoice;
}
/** The usual way in. */
export declare function createWhatsApp(options?: WhatsAppOptions): WhatsApp;
//# sourceMappingURL=index.d.ts.map