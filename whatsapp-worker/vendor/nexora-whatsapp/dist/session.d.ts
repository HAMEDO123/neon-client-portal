import { type Client } from "whatsapp-web.js";
export type LocalWhatsAppStatus = "disconnected" | "connecting" | "pending" | "connected" | "error";
export type LocalSessionSnapshot = {
    status: LocalWhatsAppStatus;
    qrDataUrl: string | null;
    pairingCode: string | null;
    phoneNumber: string | null;
    error: string | null;
};
export type LocalIncomingMessage = {
    from: string;
    body: string;
    fromMe: boolean;
    senderName: string;
    isVoice?: boolean;
    mediaBase64?: string;
    mimeType?: string;
    downloadFailed?: boolean;
    failReason?: string;
};
/**
 * Which WhatsApp line a call is about.
 *
 * A `lineId` that is null, absent or empty means the company's own main number
 * — the single line that was all this module could hold before Marketplace
 * employees could be given numbers of their own. Empty counts because "share
 * the company's number" reaches this as a blank form field as often as it does
 * a null, and either has to resolve to the main line rather than to a key that
 * no login will ever be found under. Any other `lineId` (in practice an
 * installed employee's id) is a second line belonging to the same company: its
 * own browser, its own login on disk, its own phone number.
 *
 * `label` only ever reaches logs and the admin panel, so that a human reading
 * either can tell one of a company's lines from another.
 */
export type LocalLine = {
    companyId: string;
    lineId?: string | null;
    label?: string | null;
};
/**
 * Opaque handle for one line's session. Treat it as a token: build it with
 * localSessionKey(), store it, compare it — never assemble one by hand, since
 * the format is the only thing keeping two lines' logins in separate
 * directories.
 */
export type LocalSessionKey = string;
/**
 * Anything that names a line. A bare LocalSessionKey works everywhere a
 * LocalLine does (it is parsed back into one), which is what lets a caller hold
 * nothing but the key it stored earlier. The only thing lost that way is the
 * label, which is cosmetic.
 */
export type LocalLineRef = LocalLine | LocalSessionKey;
/** Tells the incoming-message handler which line a message arrived on. */
export type LocalLineInfo = {
    sessionKey: LocalSessionKey;
    lineId: string | null;
    label: string | null;
};
/**
 * Why a line has been stopped and will not be restarted on its own.
 *
 * Every one of these means "an automatic retry would be the platform arguing
 * with WhatsApp or with the account's owner". They are cleared only by an
 * explicit customer action (startLocalLine — i.e. someone opening the linking
 * screen and scanning again), never by a timer and never by a send.
 */
export type LocalLineBlockReason = "auth_failure" | "logged_out" | "conflict" | "unpaired" | "restricted" | "qr_timeout"
/** A saved login was relaunched unattended and WhatsApp asked for a scan instead. */
 | "login_expired" | "flapping" | "unsupported";
/**
 * What the customer, and the owner's dashboard, need in order to SEE a line
 * that is unwell — instead of discovering it through a message that never
 * arrived.
 */
export type LocalLineHealth = {
    sessionKey: LocalSessionKey;
    companyId: string;
    lineId: string | null;
    isMainLine: boolean;
    label: string;
    status: LocalWhatsAppStatus;
    phoneNumber: string | null;
    /** A browser is running for this line and WhatsApp reported it connected. */
    live: boolean;
    /** A login exists on disk, so a send can relaunch this line without a scan. */
    linked: boolean;
    /** Minutes since this line last reached "ready"; null when it is not up. */
    uptimeMinutes: number | null;
    idleMinutes: number;
    lastSuccessfulSendAt: number | null;
    minutesSinceLastSuccessfulSend: number | null;
    consecutiveSendFailures: number;
    /** Relaunches in the last hour — the number that says "this line is flapping". */
    reconnectsLastHour: number;
    /** Sessions that reached ready and then dropped, in the last hour. */
    dropsLastHour: number;
    flapping: boolean;
    /** Set when the line has stopped and needs the customer to re-link it. */
    needsRelink: boolean;
    blockReason: LocalLineBlockReason | null;
    /**
     * Whether the linked account still looks reachable from this session.
     *
     * Honest about what it measures: with multi-device the handset does not have
     * to be online for the linked session to work, so this is the last connection
     * state WhatsApp Web itself reported for this account (refreshed by the
     * health pulse, and read out of the page — it costs no WhatsApp round trip).
     * It goes non-CONNECTED for exactly the cases that matter: logged out,
     * unpaired, conflicted with another Web session, or restricted. null means
     * nobody has been able to ask yet.
     */
    phoneReachable: boolean | null;
    lastKnownState: string | null;
    /** Group/channel messages ignored on this line — see the inbound filter. */
    ignoredGroupMessages: number;
    lastErrorAr: string | null;
    /** One sentence a customer can act on, in Arabic. */
    summaryAr: string;
};
type IncomingHandler = (companyId: string, message: LocalIncomingMessage, line: LocalLineInfo) => void;
/**
 * Registered by manager.ts at import time. Kept as a setter rather than a
 * direct import so this module has no dependency on the manager, which imports
 * it — the cycle would otherwise leave one of the two half-initialised.
 */
export declare function setLocalSessionMessageHandler(handler: IncomingHandler): void;
/**
 * The session key for a line. The main line's key is the company id unchanged,
 * which is what lets every session linked before this module knew about lines
 * keep working without a fresh QR scan.
 */
export declare function localSessionKey(line: LocalLine): LocalSessionKey;
/**
 * Reads a session key back into the line it names. Total by design — anything
 * that is not a well-formed line key is a main-line key, which is exactly what
 * a bare company id is.
 */
export declare function parseLocalSessionKey(key: LocalSessionKey): LocalLine;
/**
 * Called after every status change on any line — a QR appearing, a scan
 * landing, a drop, a block. The worker container registers this to push the
 * change to the main app the moment it happens, so the customer watching the
 * link screen sees "connected" when it connects and not at the next
 * heartbeat. Same setter-not-import shape as the message handler, for the
 * same reason.
 */
export declare function setLocalSessionStatusListener(listener: ((key: LocalSessionKey, snapshot: LocalSessionSnapshot) => void) | null): void;
export declare function getLocalLineStatus(ref: LocalLineRef): LocalSessionSnapshot;
export declare function getLocalSessionStatus(companyId: string): LocalSessionSnapshot;
/** Whether this line has a live, usable local session right now. */
export declare function hasLiveLocalLine(ref: LocalLineRef): boolean;
export declare function hasLiveLocalSession(companyId: string): boolean;
/**
 * Whether a saved login exists on disk for this line, even if no browser is
 * currently running for it. Used to decide whether a send should transparently
 * relaunch an evicted session rather than reporting "not connected".
 */
export declare function hasSavedLocalLine(ref: LocalLineRef): boolean;
export declare function hasSavedLocalSession(companyId: string): boolean;
/**
 * Every line with a login saved on disk, whether or not this process has held
 * a session for it yet.
 *
 * The worker container (whatsapp-worker/server.ts) reports this to the main
 * app on boot and in every heartbeat. It is how the app knows a company is
 * still linked after a restart of either side — without launching a browser
 * to find out, which is exactly the kind of launch-to-ask the QR cap exists to
 * prevent. Only directories this module would itself have written count: a
 * name that does not round-trip through the key parser is somebody else's.
 */
export declare function listSavedLocalLines(): LocalSessionKey[];
/**
 * Brings every saved line back up after this process (re)starts — one after
 * another through the launch queue, so a company with several lines does not
 * start all of its Chromiums at once.
 *
 * Nothing else does this. A saved login is what lets a SEND relaunch a line
 * transparently, but a customer messaging a company whose browser is not
 * running is not heard at all — there is no page to receive the message —
 * and until the platform's next outbound send, or a human opening the link
 * screen, nothing relaunched it. Before the per-company worker containers
 * every deploy restarted the one process holding every line, so every deploy
 * silently made every company deaf until it happened to send something. The
 * worker container calls this once on boot; nothing else should.
 *
 * Deliberately goes through launch() unforced, so a line resting in its
 * reconnect ladder, or blocked, is left exactly as it is. A saved login that
 * WhatsApp Web no longer accepts shows a QR nobody is looking at and runs
 * into the ordinary QR cap, after which the dead profile is discarded and the
 * line honestly reads as "needs re-linking" — bounded, and the truth.
 *
 * Returns the keys a launch was started for (not the keys that connected —
 * "connected" arrives through the status listener, when it does).
 */
export declare function resumeSavedLocalLines(): Promise<LocalSessionKey[]>;
/**
 * Test seam. Never set in production — a test needs to drive the reconnect,
 * auth-failure and eviction paths, and none of them can be reached honestly
 * with a real Chromium in a plain `node` script.
 */
declare let clientFactory: ((entry: {
    key: LocalSessionKey;
    linkPhoneNumber: string | null;
}) => Client) | null;
export declare function __setLocalSessionClientFactoryForTests(factory: typeof clientFactory): void;
/**
 * A message id as the string WhatsApp Web's own store is keyed by —
 * "<fromMe>_<remote>_<id>", with "_<participant>" appended in groups.
 *
 * whatsapp-web.js reads it from `id._serialized`, and so did the download
 * below. WhatsApp Web 2.3000.1046618780 stopped serialising that field: the
 * MsgKey now arrives as { fromMe, remote, id, $1 } with the canonical string
 * under a minified name. Every voice note on the platform then went to the
 * page as `undefined` and came back as "No key or key range specified" eight
 * times over, and the customer got the "could not understand" apology for a
 * note that was never even fetched. The store still accepts the string — only
 * the field it was read from moved. So: the documented field if it is there,
 * else any field already holding the canonical form (whatever it is called
 * this month), else the string rebuilt from the parts, which are the one
 * thing WhatsApp cannot rename without breaking its own clients.
 */
export declare function messageIdString(id: unknown): string | null;
/**
 * Opens (or reuses) a local WhatsApp Web session for one line and returns as
 * soon as there is something worth showing — a QR, a pairing code, a
 * connection, or an error.
 *
 * This is the one entry point that clears a block, because it is the one that
 * only happens when a human asks for it.
 */
export declare function startLocalLine(ref: LocalLineRef, linkPhoneNumber?: string | null): Promise<LocalSessionSnapshot>;
export declare function startLocalSession(companyId: string, linkPhoneNumber?: string | null): Promise<LocalSessionSnapshot>;
export declare function stopLocalLine(ref: LocalLineRef): Promise<void>;
export declare function stopLocalSession(companyId: string): Promise<void>;
/**
 * Stops a linking attempt that nobody is going to finish — the customer closed
 * the link modal, or navigated away.
 *
 * Narrow on purpose, because the wide version already exists and is wrong for
 * this. stopLocalLine() calls client.logout(), which deletes the line's saved
 * credentials; the UI could not call it on modal close without a customer who
 * closed the dialog by accident discovering their WhatsApp had been unlinked
 * (and, higher up, without the company's Cloud API credentials being deleted by
 * the disconnect action that wraps it). This only ends the attempt.
 *
 * What it does NOT touch, deliberately: a CONNECTED line (closing a modal after
 * a successful scan must leave the session running), the Cloud API credentials,
 * and any saved login that WhatsApp Web was resuming rather than asking about.
 *
 * Returns true when there really was an attempt to stop, so the caller can tell
 * "cancelled" from "nothing was running" without guessing.
 */
export declare function cancelLocalLineLinking(ref: LocalLineRef): Promise<boolean>;
export declare function cancelLocalSessionLinking(companyId: string): Promise<boolean>;
export declare function sendLocalLineText(ref: LocalLineRef, phone: string, text: string, typingDelayMs?: number): Promise<void>;
export declare function sendLocalText(companyId: string, phone: string, text: string, typingDelayMs?: number): Promise<void>;
export declare function sendLocalLineMedia(ref: LocalLineRef, phone: string, file: Buffer, mimeType: string, filename: string, asDocument: boolean): Promise<void>;
export declare function sendLocalMedia(companyId: string, phone: string, file: Buffer, mimeType: string, filename: string, asDocument: boolean): Promise<void>;
export declare function sendLocalLineVoice(ref: LocalLineRef, phone: string, audio: Buffer, mimeType: string, typingDelayMs?: number): Promise<void>;
export declare function sendLocalVoice(companyId: string, phone: string, audio: Buffer, mimeType: string, typingDelayMs?: number): Promise<void>;
export declare function startLocalSessionHousekeeping(): void;
export declare function stopLocalSessionHousekeeping(): void;
/**
 * Closes every live session properly.
 *
 * Why this matters beyond tidiness: a container that is SIGKILLed leaves each
 * WhatsApp Web session half-open from WhatsApp's side, and this platform is
 * redeployed constantly. An account whose Web session dies abruptly on a
 * schedule looks nothing like a person closing a browser tab. Sessions are
 * drained (a message already on the wire gets a moment to land) and then
 * destroyed, which ends the socket the way the protocol expects.
 */
export declare function closeAllLocalSessions(why: string): Promise<void>;
export declare function onLocalSessionShutdown(fn: ((why: string) => Promise<void>) | null): void;
/**
 * The health of one line, for the customer's own integrations screen.
 *
 * A line that is flapping, resting on the reconnect ladder, or stopped and
 * waiting to be re-linked used to be invisible until a message silently failed
 * to arrive. Returns null for a line this process has never held a session for
 * — the caller should fall back to "linked / not linked" from disk.
 */
export declare function getLocalLineHealth(ref: LocalLineRef): LocalLineHealth | null;
/** Every line this process holds a session entry for. */
export declare function localLineHealth(): LocalLineHealth[];
/**
 * Diagnostics for the admin/server panel.
 *
 * One row per line, not per company — `companyId` stops being unique the moment
 * an employee has a number of its own, so `sessionKey` is the identity to key a
 * list on and `label` is what tells a human which of a company's lines they are
 * looking at.
 *
 * A superset of the health view, so the operator panel and the customer screen
 * cannot disagree about whether a line is well.
 */
export declare function localSessionStats(): LocalLineHealth[];
/**
 * Whether a number is actually reachable on WhatsApp, asked over one specific
 * line.
 *
 * Exists because of a real failure: the travel employee scraped hotel phone
 * numbers off the web and tried to message them. Hotels publish landlines, and
 * a landline has no WhatsApp account — the send died deep inside WhatsApp Web
 * with "No LID for user", which is not a sentence anybody can act on.
 *
 * The line matters, not just the company: the answer comes from whichever
 * WhatsApp account is logged in, so a send that will leave on an employee's own
 * number has to be checked against that number's session rather than the
 * company's.
 *
 * Returns null when the answer cannot be established (no session, lookup
 * failed). Null means "unknown", not "no" — the caller must not treat an
 * unreachable lookup as proof the number is bad.
 */
export declare function isLocalLineWhatsAppNumber(ref: LocalLineRef, phone: string): Promise<boolean | null>;
export declare function isLocalWhatsAppNumber(companyId: string, phone: string): Promise<boolean | null>;
/** Test seam. Never called in production. */
export declare function __resetLocalSessionsForTests(): void;
/** Test seam. Never called in production — the sweep is on a 15-minute timer. */
export declare function __sweepIdleSessionsForTests(): void;
/**
 * Test seam. Never called in production.
 *
 * Runs everything a SIGTERM runs except the process.exit that follows it, so
 * the ordering (queue first, browsers second) is asserted rather than assumed.
 */
export declare function __runShutdownSequenceForTests(why?: string): Promise<void>;
/** Test seam. Never called in production — the pulse is on a 60-second timer. */
export declare function __pulseSessionHealthForTests(): Promise<void>;
/**
 * Test seam. Never called in production.
 *
 * Moves a line's clocks backwards so idle eviction and the post-ready quiet
 * window can be exercised without a test that sleeps for three hours.
 */
export declare function __ageLocalSessionForTests(ref: LocalLineRef, ms: number): void;
/** Test seam. Never called in production. */
export declare function __inspectLocalSessionForTests(ref: LocalLineRef): {
    hasClient: boolean;
    status: LocalWhatsAppStatus;
    generation: number;
    reconnectArmed: boolean;
    qrRefreshArmed: boolean;
    readyWatchArmed: boolean;
    dropsLastHour: number;
    qrRefreshes: number;
    reconnectAttempts: number;
    cooldownRemainingMs: number;
    blockReason: LocalLineBlockReason | null;
    inFlightSends: number;
    ignoredGroupMessages: number;
} | null;
export {};
//# sourceMappingURL=session.d.ts.map