/**
 * Not all outbound messages carry the same risk, and pacing them identically
 * is what makes the safe ones slow and the dangerous ones fast.
 *
 *  - `reply` — somebody just messaged this line and is waiting. They are
 *    demonstrably on WhatsApp, they initiated, and a business answering its
 *    own customers is the least restrictable thing a number can do. Goes
 *    promptly.
 *  - `notification` — business-initiated, to somebody who already has a
 *    relationship with the business: an order status, a booking confirmation,
 *    a quote that was asked for. Modest risk, spaced.
 *  - `cold` — the high-risk class: first contact, outreach, an RFQ to a
 *    supplier who never opted in, a nudge to a lead who has never written in.
 *    Identical text to many new recipients in a short window is the canonical
 *    bulk-unsolicited fingerprint. Spaced far more, and capped hard per day.
 */
export type OutboxClass = "reply" | "notification" | "cold";
/** Everything the owner can be told about one queued message. */
export type OutboxStatus = "queued" | "sending" | "sent" | "failed_retrying" | "failed_permanent" | "dropped";
export type OutboxFailureCode = "no_whatsapp_account" | "bad_destination" | "blocked_by_recipient" | "line_not_linked" | "transport_unavailable" | "rate_limited_upstream" | "quota_exhausted" | "gave_up" | "expired" | "queue_full" | "cold_daily_cap" | "restart_in_flight" | "unknown";
/**
 * Per-class pacing, per LINE.
 *
 * Every number gets its own copy of these. That is the correction the
 * measurement asked for: the old budgets were keyed by COMPANY, so a company
 * running its main number plus three employee numbers had four numbers sharing
 * one 5-recipient budget — collectively throttled to what a single number
 * should get, while no individual number had a limit of its own. WhatsApp
 * restricts the number. The budget belongs on the number.
 *
 * `burst` is the token-bucket capacity (how many may go back-to-back after a
 * quiet spell), `refillPerHour` is the sustained rate, `minGapMs` is the floor
 * between two sends on the same line — measured from when the previous send
 * finished, so it stacks on top of the typing delay the transport already
 * applies rather than being swallowed by it.
 */
export declare const OUTBOX_POLICY: Record<OutboxClass, {
    minGapMs: number;
    burst: number;
    refillPerHour: number;
    maxAttempts: number;
    maxDeferralMs: number;
    /** Lower is served first when several messages on one line are due at once. */
    priority: number;
}>;
/**
 * The hard cap: distinct recipients this line opens a COLD conversation with,
 * per rolling 24h.
 *
 * This is the axis WhatsApp actually scores — new conversations opened by an
 * account nobody messaged first — and it is the one number in this file that
 * is a refusal rather than a delay. Past it, cold messages are dropped with an
 * Arabic reason the owner reads, not held for tomorrow: a backlog that drains
 * at midnight is the same burst with a delay on it.
 */
export declare const COLD_DAILY_CAP: number;
/**
 * How long a DERIVED idempotency key suppresses an identical message.
 *
 * Five minutes, chosen against the three real duplicate sources rather than
 * picked round:
 *
 *   - a retried Server Action POST arrives within seconds;
 *   - a redelivered webhook arrives within seconds to a couple of minutes;
 *   - an operator double-tap is the slow one — sendRfqToSuppliers takes 30-60s
 *     of pacing with no UI proof it started, so the second click lands up to a
 *     minute after the first. A window under two minutes would miss exactly
 *     the duplicate the owner reported.
 *
 * Longer than five minutes starts swallowing genuine repeats: a business does
 * legitimately send the same short sentence ("تمام"، "وصلني") to the same
 * person twice in one conversation. Five minutes covers every mechanical
 * duplicate and blocks almost no human one — and a caller that legitimately
 * needs to repeat itself sooner passes its own idempotency key, which is
 * matched exactly instead of by content.
 *
 * The window is anchored at the FIRST enqueue and is never refreshed by
 * duplicate hits, so a caller stuck in a retry loop cannot suppress a
 * legitimate later message forever. Its hits are counted instead, which is how
 * a retry loop becomes visible rather than invisible.
 */
export declare const DERIVED_DEDUP_WINDOW_MS: number;
/**
 * A caller-supplied key names a business event ("rfq_x to supplier_y",
 * "followup_44", "order_12:ready"), not a piece of text, so it is remembered
 * for a day. That is what makes "resend the RFQ" safe: the suppliers already
 * served collapse, and only the ones that were missed go.
 */
export declare const EXPLICIT_DEDUP_WINDOW_MS: number;
export type OutboxRecord = {
    /** Durable, returned by enqueue() before anything is sent. */
    id: string;
    /** The identity of the NUMBER this leaves on (whatsAppLineKey). Every budget here is keyed by it. */
    lineKey: string;
    companyId: string;
    /** Set when the send belongs to a Marketplace employee, so its message log can be fed. */
    installedEmployeeId: string | null;
    to: string;
    text: string;
    kind: OutboxClass;
    idempotencyKey: string;
    /** True when the caller supplied the key rather than it being derived from the text. */
    idempotencyExplicit: boolean;
    status: OutboxStatus;
    /** Real transport attempts. A deferral for a down line is not an attempt. */
    attempts: number;
    enqueuedAt: number;
    /** Not before this. Moved by backoff, by a down line, and by restore. */
    dueAt: number;
    /** Past this the message is stale and is dropped rather than sent late. */
    expiresAt: number;
    lastAttemptAt: number | null;
    sentAt: number | null;
    providerMessageId: string | null;
    failureCode: OutboxFailureCode | null;
    /** Arabic, user-facing. The answer to "why did nothing go out". */
    failureReasonAr: string | null;
    /** Raw transport error, kept for the log and for reachability bookkeeping. Never shown to a customer. */
    lastErrorMessage: string | null;
    /** How many duplicates collapsed onto this. A high number is a caller stuck in a loop. */
    duplicateHits: number;
    /** e.g. «مفاوضة فندق Crown Plaza» — so a row reads without opening the feature it came from. */
    contextLabelAr: string | null;
    counterpartName: string | null;
};
export type OutboxRecordView = Readonly<OutboxRecord>;
export type OutboxSendRequest = {
    lineKey: string;
    companyId: string;
    installedEmployeeId?: string | null;
    to: string;
    text: string;
    kind: OutboxClass;
    /**
     * Name the business event, not the text: `rfq_9:supplier_3`, `followup_44`,
     * `order_12:ready`, `conv_7:inbound_991`. Two calls carrying the same key
     * are one send, for a day.
     */
    idempotencyKey?: string | null;
    contextLabelAr?: string | null;
    counterpartName?: string | null;
};
export type EnqueueResult = {
    /** The durable id. On a duplicate this is the id of the send it collapsed onto. */
    id: string;
    status: OutboxStatus;
    /** True when this call did NOT create a new send. */
    duplicate: boolean;
    /** The queue's current estimate of when this reaches the transport. */
    estimatedSendAt: number;
    /** Arabic, set when the message was refused outright (never queued). */
    reasonAr: string | null;
};
/**
 * What the queue needs from whatever actually carries the message.
 *
 * An interface, so the pacing, dedup, classification and backoff can be tested
 * with a fake clock and no network — and so this file never has to know
 * whether the message left over the Cloud API, the Connector, or a local
 * whatsapp-web.js session.
 */
export type OutboxTransport = {
    /** Resolves when the message is with WhatsApp. Throws to fail; see classifySendFailure. */
    send(job: OutboxRecordView): Promise<{
        providerMessageId?: string | null;
    } | void>;
    /**
     * Whether the line is linked right now. False defers instead of failing: a
     * session that is reconnecting is not a reason to lose a customer's reply,
     * and it is definitely not a reason to hammer a dead transport.
     */
    lineReady?(lineKey: string): boolean;
};
/**
 * Thrown by a transport that already knows the failure is permanent — a route
 * refusal (`destination_not_on_whatsapp`, `bad_destination`), a reachability
 * verdict — so the queue does not have to re-derive it from an error string.
 */
export declare class PermanentSendError extends Error {
    readonly code: OutboxFailureCode;
    readonly reasonAr: string;
    constructor(reasonAr: string, code?: OutboxFailureCode);
}
/** Thrown when the company's message allowance is spent. Not a transport fault, never retried on a timer. */
export declare class QuotaSendError extends Error {
    readonly reasonAr: string;
    constructor(reasonAr: string);
}
/**
 * Where non-terminal messages live so a restart does not eat them.
 *
 * Only queued/sending/retrying records are journalled — a message that has
 * been sent, permanently failed or dropped has nothing left to resume, and
 * keeping it would grow the file without bound.
 */
export type OutboxJournal = {
    load(): OutboxRecord[];
    save(records: OutboxRecord[]): void;
};
export declare function memoryOutboxJournal(seed?: OutboxRecord[]): OutboxJournal & {
    records: OutboxRecord[];
};
/**
 * The production journal. Written the way store-persistence.ts writes the
 * store, and for the same reason: this file is the only copy of a customer's
 * queued messages, and a truncate-then-stream write killed mid-flight is how
 * this deployment previously turned real data into a parse error.
 *
 * So: serialize, write to a temp file, FSYNC IT, rename over the target, fsync
 * the directory. Without the fsync the rename can commit while the content is
 * still only in the page cache, and a host power cut then leaves a file that
 * exists, has the right length and is full of zeros. The previous version here
 * had the rename but not the fsync, which is the half that makes it durable
 * rather than merely non-truncating.
 *
 * The write is synchronous and happens on every state change. That is a real
 * cost and it is the right one: the file holds only messages still waiting
 * (tens, not thousands), and the alternative — a debounced write — has a window
 * in which the newest queued message is exactly the one a SIGTERM loses.
 *
 * WHAT RECOVERS IT on the next boot is only ever a temp file newer than the
 * damaged journal — an interrupted write, i.e. the newest state that existed.
 * There is deliberately no rotated backup; see the note beside the write.
 *
 * WHEN THE WRITE FAILS the records are kept in `unwritten` and retried at exit,
 * the failure is reported (loudly the first time, then every tenth, because a
 * disk that is full stays full and a log line per save helps nobody), and the
 * queue keeps running: an undeliverable journal costs the backlog a restart,
 * not the customer their message.
 */
export declare function fileOutboxJournal(filePath: string): OutboxJournal;
/** Digits, or a JID left intact — an inbound @c.us/@lid address is not a phone number. */
export declare function normalizeAddress(to: string): string;
/** FNV-1a. Not a security hash — it only has to make two different messages differ. */
export declare function hashText(text: string): string;
/**
 * The key used when the caller supplies none: this line, this recipient, this
 * text.
 *
 * Note what is NOT in it: a floor-divided time bucket. `floor(now / 5min)` is
 * the obvious implementation and it is wrong — two sends one second apart on
 * either side of a bucket boundary land in different buckets and both go out.
 * The window is applied as a sliding TTL on the key instead, anchored at the
 * first enqueue, which has no boundary to straddle.
 */
export declare function derivedIdempotencyKey(lineKey: string, to: string, text: string): string;
export declare function backoffDelayMs(attempt: number, random?: () => number): number;
export type FailureClass = {
    kind: "permanent" | "transient" | "line_down" | "quota";
    code: OutboxFailureCode;
    reasonAr: string;
};
/**
 * Which failures may be retried, and which must never be.
 *
 * This is the function that exists because of the landline incident. A number
 * with no WhatsApp account, a malformed number, a recipient who blocked the
 * business — retrying any of those is not persistence, it is the abuse
 * signature itself. whatsapp-web.js reports the first as "No LID for user"
 * from deep inside its own internals, which is why that exact string is
 * matched here rather than hoped about.
 *
 * Ordering matters: "not-authorized" and the JID family are destination
 * verdicts, not auth problems, so they are matched before anything generic.
 */
export declare function classifySendFailure(err: unknown): FailureClass;
export type OutboxLineSnapshot = {
    lineKey: string;
    queued: number;
    sending: number;
    retrying: number;
    /** How long the oldest waiting message has been waiting, in ms. */
    oldestWaitMs: number;
    nextDueAt: number | null;
    coldSentLast24h: number;
    coldRemainingToday: number;
    /** Arabic, for the employee's messages tab. Null when there is nothing to say. */
    noteAr: string | null;
};
export type OutboxDeps = {
    now: () => number;
    transport: OutboxTransport;
    journal?: OutboxJournal;
    random?: () => number;
    /**
     * Fired on every state change, so the per-employee message log can mirror
     * it. UPSERT BY `record.id` — the same id is announced repeatedly as the
     * message moves, and once more each time a duplicate collapses onto it.
     * Appending instead of replacing would turn one message into a dozen rows.
     */
    onChange?: (record: OutboxRecordView) => void;
    log?: (line: string) => void;
};
/**
 * Quiesces every live queue. Called from the process's shutdown path — see
 * WhatsAppOutbox.shutdown for what the drain is actually buying.
 */
export declare function shutdownWhatsAppOutboxes(drainMs?: number): Promise<void>;
export declare class WhatsAppOutbox {
    private readonly deps;
    private readonly lines;
    private readonly byId;
    private readonly dedup;
    /** Records that fell off a line's recent list while their idempotency key was still live. */
    private readonly orphaned;
    private seq;
    private observer;
    /** Set by shutdown(): the process is going down and must start nothing new. */
    private stopping;
    constructor(deps: OutboxDeps);
    /** Attached after construction so restore()'s notifications reach it too. */
    setObserver(fn: ((record: OutboxRecordView) => void) | null): void;
    /**
     * Takes a message and returns immediately. Nothing here waits on pacing, on
     * a browser, or on WhatsApp — that is the whole point: a caller that blocks
     * on send pacing is a caller that eventually times out and retries, which is
     * how the duplicates were being manufactured.
     */
    enqueue(req: OutboxSendRequest): EnqueueResult;
    private refuseUpFront;
    /**
     * One pass: every line gets a look, and each line may hand at most one
     * message to the transport.
     *
     * Lines are pumped in parallel and hold their own state, which is what makes
     * them isolated: a line saturated with cold outreach delays only itself, and
     * a second line's reply still goes out on time. Under the old company-keyed
     * budgets that was exactly backwards.
     */
    tick(): Promise<void>;
    /**
     * Quiesces the queue for a process that is going down.
     *
     * The restart story has a hole that only shutdown can close. A record in
     * `sending` when the process dies is dropped on the next boot as
     * `restart_in_flight` — deliberately, because resending is a coin flip
     * between a duplicate and nothing, and duplicates are the abuse tell. But
     * that decision costs a real customer a real message, and on a platform that
     * redeploys constantly it costs one every deploy that lands mid-send.
     *
     * So on the way down: stop STARTING sends (a send begun in the last second
     * before SIGTERM is the one guaranteed not to finish), and give the sends
     * already on the wire a moment to settle into `sent` or `failed_retrying`,
     * which are states the next boot can act on. Then journal.
     *
     * Bounded by `drainMs` because Docker sends SIGKILL a few seconds after
     * SIGTERM: overrunning turns a graceful stop into the abrupt kill this is
     * trying to avoid. Whatever is still in flight at the deadline falls back to
     * the honest `restart_in_flight` drop.
     */
    shutdown(drainMs?: number): Promise<{
        drained: number;
        stillSending: number;
    }>;
    /** Test seam, and the dev-server case where a module is re-evaluated rather than restarted. */
    resume(): void;
    private pumpLine;
    private settleSent;
    private settleFailure;
    private expireOverdue;
    /**
     * Reads the journal back after a restart.
     *
     * THE ANSWER TO "DOES IT SURVIVE A RESTART": yes for messages that were
     * still waiting, no for a message that was mid-flight — and the second half
     * is a decision, not an omission.
     *
     * A record left in `sending` means the process died between handing the
     * message to WhatsApp and hearing back. Neither transport leaves us anything
     * to correlate against afterwards (whatsapp-web.js has no receipt we stored,
     * and the Cloud API's wamid only comes back in the response we never got),
     * so resending is a coin flip between delivering the same message twice and
     * not delivering it at all. Duplicate delivery is the abuse tell the owner
     * already reported, so the flip is refused: the message is dropped with an
     * Arabic reason saying exactly that and flagged for the owner, who decides.
     * A silent resend would be the worst of both.
     *
     * Nothing goes out for RESTART_QUIET_MS and the buckets do not come back
     * full, so a restart with a backlog does not answer by bursting.
     */
    restore(): {
        requeued: number;
        droppedInFlight: number;
        expired: number;
    };
    get(id: string): OutboxRecordView | null;
    /** Every state a message can be in, for the employee's messages tab. */
    listForEmployee(installedEmployeeId: string, limit?: number): OutboxRecordView[];
    snapshot(lineKey: string): OutboxLineSnapshot;
    /** Non-terminal depth across every line — for the admin panel. */
    depth(): number;
    lineKeys(): string[];
    private lineFor;
    private refill;
    private estimateSendAt;
    private remove;
    /**
     * A settled message stays readable.
     *
     * The owner opening an employee's messages tab an hour later must still find
     * the row that says why nothing went out — a failure that disappears from
     * the UI is the same silence this queue exists to end. So a terminal record
     * is kept per line (the newest 100, which bounds the memory), and is only
     * really forgotten once it has fallen off that list AND its idempotency key
     * has expired, since until then a duplicate can still collapse onto it.
     */
    private remember;
    private pruneDedup;
    private persist;
    private emit;
    private warn;
    private nextId;
}
/**
 * How a queue state reads in the per-employee message log, whose vocabulary
 * predates this queue ("queued" | "sent" | "delivered" | "failed" | "refused").
 *
 * A message still being retried reads as `queued`, not `failed`: it has not
 * stopped, and a row that says "failed" while the queue is still trying is a
 * row that makes the owner send it again by hand — which is a duplicate.
 */
export declare function outboxStatusToDelivery(status: OutboxStatus): "queued" | "sent" | "failed" | "refused";
/** Whether this row needs the owner's eyes before anything else moves. */
export declare function outboxNeedsAttention(record: OutboxRecordView): boolean;
//# sourceMappingURL=outbox.d.ts.map