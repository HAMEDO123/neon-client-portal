import fs from "fs";
import path from "path";
import QRCode from "qrcode";
// Named imports from this package fail under plain Node ESM (used by
// whatsapp-worker/server.ts and the *-test.mjs scripts via ts-resolve-hook,
// as opposed to webpack, which bundles the main app and tolerates named
// imports here fine) — whatsapp-web.js's index.js builds module.exports
// with a trailing `...Constants` spread, which defeats Node's static
// cjs-module-lexer named-export detection even though Client/LocalAuth/
// MessageMedia are themselves plain, statically-visible keys on the same
// object. The default-import + runtime destructure below needs no static
// analysis of the CJS export shape at all, and works identically under both
// webpack and plain Node ESM.
import whatsappWebJs from "whatsapp-web.js";
// `Client` above is the TYPE (statically resolvable — TS reads the .d.ts
// directly, no CJS runtime export detection involved). `ClientCtor` is the
// actual constructor value, bound this way rather than as `Client` too:
// TS would otherwise error on Client being "a value ... used as a type"
// wherever a parameter is annotated `client: Client`, because a plain
// `const Client = ...` in the same module shadows the type-only import.
const { Client: ClientCtor, LocalAuth, MessageMedia } = whatsappWebJs;
// Values carried over from the Connector, where they were arrived at against
// real WhatsApp Web rather than guessed.
//
// The QR cadence tracks WhatsApp's own code expiry, so it is clamped to a sane
// band rather than being freely settable. What actually bounds the cost of an
// abandoned linking attempt is MAX_QR_REFRESHES below, not this.
const QR_REFRESH_MS = Math.min(120_000, Math.max(2_000, Number(process.env.WHATSAPP_QR_REFRESH_MS ?? 60_000) || 60_000));
const POST_READY_QUIET_MS = 20_000;
// A launch that resolves but never reaches "ready". Seen on a real worker
// boot: the browser was logged in, WhatsApp Web's socket was CONNECTED and
// synced, and whatsapp-web.js had wired 14 of its ~30 page bindings when
// the wiring simply stopped — no error, no event, the line at "connecting"
// forever. A restart brought it back in nine seconds. Beyond this long with
// no ready (and no QR — a QR is the page talking) the line is treated as a
// transient drop: torn down and relaunched through the ordinary ladder, so a
// browser that is genuinely broken still stops after the usual budget.
// 45s, not longer: the watchdog is armed only once initialize() has returned,
// i.e. the browser is up and the page loaded, and from there "ready" takes
// seconds — every real boot on the company machine connected within 15s.
// The first deploy with the watchdog stalled twice in a row before the third
// launch connected, so each extra second here is a second the company's
// customers are unheard for.
const READY_TIMEOUT_MS = Math.max(1_000, Number(process.env.WHATSAPP_READY_TIMEOUT_MS ?? 45_000) || 45_000);
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
const MAX_RECONNECT_ATTEMPTS = 5;
// After the consecutive ladder is exhausted the line RESTS rather than being
// declared dead. A server that lost its network for ten minutes must not force
// every customer to re-scan a QR code — but it also must not keep knocking on
// WhatsApp's door every thirty seconds for those ten minutes. One attempt per
// rest period is enough to notice the network came back.
const RECONNECT_REST_MS = 15 * 60_000;
// A line that connects and drops repeatedly is the shape WhatsApp reads as an
// automation harness, and each cycle registers a fresh Web session against the
// customer's account. Consecutive-failure counting cannot see it, because every
// "ready" resets that counter — this budget deliberately does not reset on
// "ready". Past it the line stops and asks to be re-linked, because something
// is wrong that reconnecting will not fix.
const DROP_BUDGET_PER_HOUR = Math.max(2, Number(process.env.WHATSAPP_DROP_BUDGET_PER_HOUR ?? 6) || 6);
const HOUR_MS = 60 * 60_000;
// One abandoned QR attempt used to cost a Chromium launch and an unauthenticated
// WhatsApp Web registration handshake every minute forever. Five refreshes is
// about five minutes, which is longer than any real person takes to scan.
const MAX_QR_REFRESHES = Math.max(1, Number(process.env.WHATSAPP_MAX_QR_REFRESHES ?? 5) || 5);
// A wall clock on the whole linking attempt, because the refresh counter alone
// can be defeated: WhatsApp Web regenerates the code inside the page every
// twenty seconds or so and whatsapp-web.js re-emits "qr" each time, which
// re-arms the refresh timer. Counting only our own relaunches would let a page
// that keeps refreshing itself hold a browser — and an unfinished registration
// — open indefinitely.
const LINK_WINDOW_MS = MAX_QR_REFRESHES * QR_REFRESH_MS;
// Chromium is roughly 300-400 MB resident per session. The cap is the honest
// admission that this does not scale to arbitrarily many companies on one box;
// exceeding it fails loudly with an actionable message instead of quietly
// swapping the machine to death.
const MAX_CONCURRENT_SESSIONS = Number(process.env.WHATSAPP_MAX_SESSIONS ?? 8);
// The cap above protects the machine; this one protects tenants from each
// other. While a company could hold only one session the global cap was the
// whole story. Now that one company can hand nine Marketplace employees nine
// numbers, that single company would take every slot on the box and every other
// company's link would start failing — so a company's appetite for lines is
// capped before it becomes everyone else's outage. Floored at 1 because a
// mistyped env var resolving to 0 would otherwise lock every company out of its
// own main line.
const MAX_LINES_PER_COMPANY = Math.max(1, Number(process.env.WHATSAPP_MAX_LINES_PER_COMPANY ?? 4) || 4);
// A session nobody has sent or received on for this long is closed. Its login
// survives on disk, so the next send transparently relaunches it.
const IDLE_EVICT_MS = Number(process.env.WHATSAPP_IDLE_EVICT_MINUTES ?? 180) * 60_000;
const SWEEP_INTERVAL_MS = 15 * 60_000;
// Reads Store.AppState out of the already-open page. No WhatsApp round trip, so
// it is safe to do often — and it is the only way to notice a session whose
// browser is alive but whose page is dead, which otherwise stays invisible
// until a customer's message fails to send.
const HEALTH_PULSE_MS = 60_000;
const STATE_PROBE_TIMEOUT_MS = 10_000;
// A hung destroy() must not hold a deploy open, and Docker sends SIGKILL a few
// seconds after SIGTERM anyway.
const CLOSE_TIMEOUT_MS = 5_000;
const SHUTDOWN_GRACE_MS = Math.max(1_000, Number(process.env.WHATSAPP_SHUTDOWN_GRACE_MS ?? 6_000) || 6_000);
// How long shutdown waits for a message that is already on the wire.
const IN_FLIGHT_DRAIN_MS = 2_000;
// Contact-existence lookups (getNumberId) are usync queries, and WhatsApp
// scores enumeration independently of messaging. A caller loop that asks about
// the same dead number every sixty seconds — which has happened — costs nothing
// past the first ask thanks to this memo. reachability.ts caches the same
// answer at a higher layer; this is the backstop for callers that reach the
// transport directly.
const LOOKUP_MEMO_MS = 10 * 60_000;
const LOOKUP_BUDGET_PER_HOUR = Math.max(10, Number(process.env.WHATSAPP_LOOKUP_BUDGET_PER_HOUR ?? 120) || 120);
/**
 * The only JID shapes this platform will talk to.
 *
 * @c.us is a personal number, @lid is WhatsApp's privacy address for one. Every
 * other suffix is a place an AI employee has no business speaking: @g.us is a
 * group, @newsletter is a channel, @broadcast is a broadcast list. There is no
 * setting for this on purpose — see the header.
 */
const ADDRESSABLE_JID = /@(c\.us|lid)$/i;
// Keyed by session key, not by company id: a company holds as many entries here
// as it has linked lines.
//
// Parked on globalThis like every other shared singleton in this codebase
// (mock.ts's __platformMockStore, agent-relay/registry.ts's __agentRelay) —
// this one was the exception, and it showed: Next.js compiles Server
// Components and Server Actions as separate module graphs, so a plain
// module-scope `const` here was actually two different Maps at runtime. A
// company's fresh page load (a Server Component reading getLocalSessionStatus)
// and its QR-linking flow (a Server Action calling startLocalSession) landed
// in different copies, so a session that connected via the Action was
// invisible to the Component's read — the dashboard reported "connecting"
// forever after a reload even though the real session was alive and well.
const gSessions = globalThis;
const sessions = gSessions.__platformLocalWhatsAppSessions ?? new Map();
gSessions.__platformLocalWhatsAppSessions = sessions;
const DISCONNECTED = { status: "disconnected", qrDataUrl: null, pairingCode: null, phoneNumber: null, error: null };
let incomingHandler = null;
/**
 * Registered by manager.ts at import time. Kept as a setter rather than a
 * direct import so this module has no dependency on the manager, which imports
 * it — the cycle would otherwise leave one of the two half-initialised.
 */
export function setLocalSessionMessageHandler(handler) {
    incomingHandler = handler;
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Bounds anything that talks to Chromium. destroy() and getState() both go
 * through CDP to a browser that may already be wedged, and an unbounded await
 * on a wedged browser is how a deploy turns into a SIGKILL — the abrupt
 * disconnect this file is trying to stop emitting.
 */
function withTimeout(work, ms, what) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
        timer.unref?.();
        work.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}
// --- session keys ----------------------------------------------------------
// A session key doubles as LocalAuth's clientId, and LocalAuth resolves the
// on-disk profile as path.join(dataPath, "session-" + clientId). Two things
// follow, both read out of its source rather than assumed:
//
//   - it rejects any clientId outside /^[-_\w]+$/i outright, so ":" or "/" as a
//     separator would throw on every launch — and "/" would escape the sessions
//     root entirely if it did not;
//   - the key IS the directory name, so two lines that derive the same key
//     share one Chromium profile, which means two tenants sharing one WhatsApp
//     login. Plain concatenation cannot be trusted to avoid that: company ids
//     and employee ids look like `company_demo` and `inst_slpl5ev7`, both
//     contain "_", and every legal separator is also a legal id character — so
//     `${companyId}_${lineId}` is ambiguous, with company "company_demo_inst"
//     line "x" landing on the same directory as company "company_demo" line
//     "inst_x".
//
// So a line key carries the company id's length ahead of it, which is
// unambiguous for any id in the allowed alphabet. It stays human-readable on
// purpose: an operator looking at data-selfhost/whatsapp-sessions/ can still
// tell whose login a directory holds, and what is being debugged there is
// somebody's live WhatsApp account.
const LINE_KEY_PREFIX = "wl1";
// Deliberately the same alphabet LocalAuth enforces, so a bad id is refused
// here — where the message can name it — rather than deep inside a launch.
const USABLE_ID = /^[-\w]+$/;
const MAX_ID_CHARS = 64;
function assertUsableId(value, what) {
    if (!value || !USABLE_ID.test(value) || value.length > MAX_ID_CHARS) {
        throw new Error(`معرّف غير صالح لجلسة واتساب (${what}): ${value}`);
    }
    return value;
}
/**
 * The session key for a line. The main line's key is the company id unchanged,
 * which is what lets every session linked before this module knew about lines
 * keep working without a fresh QR scan.
 */
export function localSessionKey(line) {
    const companyId = assertUsableId(line.companyId, "الشركة");
    if (companyId.startsWith(`${LINE_KEY_PREFIX}-`)) {
        // The one shape of company id whose main-line key could be read back as
        // some other company's second line. Ids are generated as `company_<random>`
        // so this cannot happen today; it is here so a future id scheme fails
        // loudly instead of silently pointing two tenants at one login.
        throw new Error(`معرّف شركة محجوز لا يصلح مفتاحاً لجلسة واتساب: ${companyId}`);
    }
    if (!line.lineId)
        return companyId;
    const lineId = assertUsableId(line.lineId, "الخط");
    return `${LINE_KEY_PREFIX}-${companyId.length}-${companyId}-${lineId}`;
}
/**
 * Reads a session key back into the line it names. Total by design — anything
 * that is not a well-formed line key is a main-line key, which is exactly what
 * a bare company id is.
 */
export function parseLocalSessionKey(key) {
    const marker = `${LINE_KEY_PREFIX}-`;
    if (!key.startsWith(marker))
        return { companyId: key, lineId: null };
    const rest = key.slice(marker.length);
    const dash = rest.indexOf("-");
    if (dash <= 0)
        return { companyId: key, lineId: null };
    const length = Number(rest.slice(0, dash));
    if (!Number.isInteger(length) || length <= 0)
        return { companyId: key, lineId: null };
    const body = rest.slice(dash + 1);
    if (body.length <= length || body[length] !== "-")
        return { companyId: key, lineId: null };
    const companyId = body.slice(0, length);
    const lineId = body.slice(length + 1);
    if (!lineId)
        return { companyId: key, lineId: null };
    return { companyId, lineId };
}
function asLine(ref) {
    return typeof ref === "string" ? parseLocalSessionKey(ref) : ref;
}
/**
 * The key for a lookup that has no business failing. A read-only query about an
 * id that cannot name a line answers "no session", the way it did when these
 * were plain Map reads on a company id; only the paths that launch a browser or
 * send a message throw, which is where a malformed id has to be loud.
 */
function lookupKey(ref) {
    try {
        return localSessionKey(asLine(ref));
    }
    catch {
        return null;
    }
}
// --- paths -----------------------------------------------------------------
// Matches LocalAuth's own layout exactly: it resolves the profile directory as
// path.join(dataPath, "session-" + clientId). Mirroring that here (rather than
// a similarly-named path) is what lets the lock-clearing below target the real
// directory, and what lets the sessions copied over from the old deployment —
// data/whatsapp-sessions/session-company_demo and friends — resume without a
// fresh scan.
function sessionsRoot() {
    return path.join(process.cwd(), "data", "whatsapp-sessions");
}
function profileDir(key) {
    return path.join(sessionsRoot(), `session-${key}`);
}
/**
 * Chromium refuses to start on a profile that still holds the lock files of a
 * process that was killed rather than closed — which is every unclean container
 * restart. They are safe to delete precisely because the owning process is gone.
 *
 * "Precisely because the owning process is gone" is load-bearing, and it was
 * not always true: a reconnect used to call this while the previous Chromium
 * for the same profile was still running, deleting a live lock and letting two
 * browsers share one WhatsApp login. launch() now refuses to build a second
 * client for a line that still has one, which is what makes this safe again.
 */
function clearStaleLocks(key) {
    const dir = profileDir(key);
    for (const name of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
        try {
            fs.rmSync(path.join(dir, name), { force: true });
        }
        catch {
            // A lock that cannot be removed is reported by the launch failure itself.
        }
    }
}
function hasSavedProfile(key) {
    try {
        return fs.existsSync(path.join(profileDir(key), "Default"));
    }
    catch {
        return false;
    }
}
/**
 * Removes the Chromium profile left behind by a linking attempt that never
 * authenticated.
 *
 * This closes the one way the QR cap could still be defeated. LocalAuth creates
 * <profile>/Default the moment Chromium starts, so an abandoned scan leaves a
 * directory that hasSavedProfile() reads as "this line is linked". The cap and
 * the block that follow it live only in memory, so every process restart — and
 * this platform is redeployed constantly — met a send with "linked, relaunch
 * it", showed a QR nobody was watching, and spent the whole refresh budget on
 * fresh unauthenticated WhatsApp Web registrations again. Bounded per boot,
 * unbounded over a month of deploys.
 *
 * Only ever called with authenticatedThisAttempt false, i.e. while WhatsApp Web
 * was asking to be linked rather than resuming — so there are no working
 * credentials here to lose. Deleting it makes "not linked" true on disk, which
 * turns the next send into an immediate, honest refusal instead of another
 * launch.
 */
function discardUnlinkedProfile(entry) {
    if (entry.authenticatedThisAttempt)
        return;
    try {
        fs.rmSync(profileDir(entry.key), { recursive: true, force: true });
    }
    catch (err) {
        // Windows holds handles open a moment after the browser exits. Leaving the
        // directory behind is the old behaviour, not a new failure, so it is worth
        // a line in the log and nothing more.
        console.warn(`[whatsapp] could not remove the unfinished login profile for ${describe(entry)}:`, err instanceof Error ? err.message : err);
    }
}
// --- launch queue ----------------------------------------------------------
// Chromium startup is CPU- and IO-heavy, and running several at once is what
// turned one company's connect into everyone's outage. Launches are therefore
// strictly serialised: concurrency here buys nothing and costs availability.
let launchChain = Promise.resolve();
function enqueueLaunch(task) {
    const run = launchChain.then(task, task);
    // Keep the chain alive regardless of individual outcomes; a rejected launch
    // must not poison every subsequent one.
    launchChain = run.then(() => undefined, () => undefined);
    return run;
}
// --- session state ---------------------------------------------------------
function entryFor(ref) {
    const line = asLine(ref);
    const key = localSessionKey(line);
    let entry = sessions.get(key);
    if (!entry) {
        entry = {
            key,
            companyId: line.companyId,
            lineId: line.lineId ?? null,
            label: line.label ?? null,
            client: null,
            snapshot: { ...DISCONNECTED },
            readyAt: null,
            lastActivityAt: Date.now(),
            qrRefreshTimer: null,
            readyTimer: null,
            qrRefreshes: 0,
            linkStartedAt: null,
            authenticatedThisAttempt: false,
            reconnectTimer: null,
            reconnectAttempts: 0,
            reconnectLog: [],
            dropLog: [],
            cooldownUntil: 0,
            linkPhoneNumber: null,
            launching: null,
            generation: 0,
            inFlightSends: 0,
            lastSendOkAt: null,
            lastSendFailedAt: null,
            consecutiveSendFailures: 0,
            lastErrorAr: null,
            block: null,
            lastState: null,
            lastStateAt: null,
            ignoredGroupMessages: 0,
            lookupMemo: new Map(),
            lookupLog: [],
        };
        sessions.set(key, entry);
    }
    else if (line.label) {
        // A renamed employee should read correctly in the admin panel and the logs
        // without anybody having to disconnect and re-link its line.
        entry.label = line.label;
    }
    return entry;
}
/**
 * Reads the current block through a call, on purpose.
 *
 * A block can be set by an event handler (auth_failure, CONFLICT, a TOS block)
 * while a caller is awaiting a launch, but TypeScript's narrowing assumes a
 * property it has already tested cannot change across an await. Going through a
 * function is what makes a re-check after an await mean what it says.
 */
function blockOf(entry) {
    return entry.block;
}
/** How a line is named in logs — enough to tell two lines of one company apart. */
function describe(entry) {
    if (!entry.lineId)
        return entry.companyId;
    return `${entry.companyId}/${entry.lineId}${entry.label ? ` (${entry.label})` : ""}`;
}
let statusListener = null;
/**
 * Called after every status change on any line — a QR appearing, a scan
 * landing, a drop, a block. The worker container registers this to push the
 * change to the main app the moment it happens, so the customer watching the
 * link screen sees "connected" when it connects and not at the next
 * heartbeat. Same setter-not-import shape as the message handler, for the
 * same reason.
 */
export function setLocalSessionStatusListener(listener) {
    statusListener = listener;
}
function setSnapshot(entry, patch) {
    const before = entry.snapshot;
    entry.snapshot = { ...entry.snapshot, ...patch };
    if (patch.error)
        entry.lastErrorAr = patch.error;
    const after = entry.snapshot;
    if (statusListener &&
        (before.status !== after.status || before.qrDataUrl !== after.qrDataUrl || before.pairingCode !== after.pairingCode || before.phoneNumber !== after.phoneNumber)) {
        try {
            statusListener(entry.key, after);
        }
        catch (err) {
            console.warn(`[whatsapp] status listener threw for ${describe(entry)}:`, err instanceof Error ? err.message : err);
        }
    }
}
export function getLocalLineStatus(ref) {
    const key = lookupKey(ref);
    return (key ? sessions.get(key)?.snapshot : null) ?? { ...DISCONNECTED };
}
export function getLocalSessionStatus(companyId) {
    return getLocalLineStatus({ companyId });
}
/** Whether this line has a live, usable local session right now. */
export function hasLiveLocalLine(ref) {
    const key = lookupKey(ref);
    const entry = key ? sessions.get(key) : null;
    return Boolean(entry?.client && entry.snapshot.status === "connected");
}
export function hasLiveLocalSession(companyId) {
    return hasLiveLocalLine({ companyId });
}
/**
 * Whether a saved login exists on disk for this line, even if no browser is
 * currently running for it. Used to decide whether a send should transparently
 * relaunch an evicted session rather than reporting "not connected".
 */
export function hasSavedLocalLine(ref) {
    const key = lookupKey(ref);
    return key ? hasSavedProfile(key) : false;
}
export function hasSavedLocalSession(companyId) {
    return hasSavedLocalLine({ companyId });
}
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
export function listSavedLocalLines() {
    let names;
    try {
        names = fs.readdirSync(sessionsRoot());
    }
    catch {
        return [];
    }
    const keys = [];
    for (const name of names) {
        if (!name.startsWith("session-"))
            continue;
        const key = name.slice("session-".length);
        if (lookupKey(key) !== key)
            continue;
        if (hasSavedProfile(key))
            keys.push(key);
    }
    return keys;
}
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
export async function resumeSavedLocalLines() {
    const resumed = [];
    for (const key of listSavedLocalLines()) {
        if (shuttingDown)
            break;
        const entry = entryFor(parseLocalSessionKey(key));
        if (entry.client || entry.launching || entry.block)
            continue;
        entry.lastActivityAt = Date.now();
        console.log(`[whatsapp] resuming the saved login for ${describe(entry)} on boot`);
        try {
            await launch(entry);
            resumed.push(key);
        }
        catch (err) {
            // launch() reports its own failures into the snapshot and arms the
            // ladder; a throw here is something outside that, and the next line's
            // resume must not be lost to it.
            console.warn(`[whatsapp] boot resume failed for ${describe(entry)}:`, err instanceof Error ? err.message : err);
        }
    }
    return resumed;
}
// --- who a line may talk to ------------------------------------------------
/**
 * Accepts either a bare number or an already-suffixed JID, and refuses anything
 * that is not one person.
 *
 * Inbound messages carry a full JID (which may be an @lid privacy address, not
 * a phone number at all), and replying to those requires sending it back
 * unchanged. What is NOT allowed through is a group, channel or broadcast JID:
 * the inbound filter already stops the platform from ever learning one, and
 * this is the second half of the same rule for any caller that obtained one
 * elsewhere. An AI employee posting into a group is one of the most heavily
 * enforced behaviours on WhatsApp, and there is no product reason to do it.
 */
function toJid(phone) {
    const raw = (phone ?? "").trim();
    if (raw.includes("@")) {
        if (!ADDRESSABLE_JID.test(raw)) {
            throw new Error("لا يرسل المساعد داخل مجموعات أو قنوات واتساب — أرسل الرسالة إلى رقم شخصي.");
        }
        return raw;
    }
    const digits = raw.replace(/\D/g, "");
    if (!digits)
        throw new Error("لا يوجد رقم واتساب صالح لإرسال الرسالة إليه.");
    return `${digits}@c.us`;
}
// --- lifecycle -------------------------------------------------------------
function clearQrRefresh(entry) {
    if (entry.qrRefreshTimer) {
        clearTimeout(entry.qrRefreshTimer);
        entry.qrRefreshTimer = null;
    }
}
function clearReadyWatch(entry) {
    if (entry.readyTimer) {
        clearTimeout(entry.readyTimer);
        entry.readyTimer = null;
    }
}
/**
 * Arms the stalled-launch watchdog for the client of `generation`. Inert if
 * anything at all happened to the line in the meantime — a ready, a QR, a
 * block, a teardown — because each of those is the page talking, and this
 * exists only for the silence.
 */
function watchForReady(entry, generation) {
    clearReadyWatch(entry);
    entry.readyTimer = setTimeout(() => {
        entry.readyTimer = null;
        if (entry.generation !== generation || shuttingDown || entry.block || !entry.client)
            return;
        if (entry.readyAt !== null || entry.snapshot.status !== "connecting")
            return;
        console.warn(`[whatsapp] no "ready" from ${describe(entry)} ${Math.round(READY_TIMEOUT_MS / 1000)}s after its browser started — relaunching`);
        void handleTransientDisconnect(entry, "ready timeout");
    }, READY_TIMEOUT_MS);
    entry.readyTimer.unref?.();
}
function clearReconnect(entry) {
    if (entry.reconnectTimer) {
        clearTimeout(entry.reconnectTimer);
        entry.reconnectTimer = null;
    }
}
/**
 * Stops a line for good and says why, in Arabic, where the customer reads it.
 *
 * Everything that lands here is a case where retrying is the wrong move: the
 * customer logged the device out, WhatsApp handed the session to another Web
 * client, the saved credentials no longer authenticate, or the account has been
 * restricted. Continuing to relaunch in any of those states is itself part of
 * what gets a number flagged, and it also hides the real answer from the person
 * who could fix it.
 */
function blockLine(entry, reason, ar) {
    entry.block = { reason, ar, at: Date.now() };
    clearQrRefresh(entry);
    clearReconnect(entry);
    entry.cooldownUntil = 0;
    entry.qrRefreshes = 0;
    // LOGOUT, a timed-out link and an expired login are ordinary "not connected"
    // states to the rest of the platform — nothing has gone wrong with the
    // server. The rest are real errors the owner needs to see in red.
    const status = reason === "logged_out" || reason === "qr_timeout" || reason === "login_expired" ? "disconnected" : "error";
    setSnapshot(entry, { status, qrDataUrl: null, pairingCode: null, error: ar });
    console.warn(`[whatsapp] line stopped for ${describe(entry)} (${reason}) — needs re-linking`);
    // The discard is chained rather than called: the profile directory cannot be
    // removed while its Chromium still owns it.
    void teardown(entry, { keepStatus: true, reason }).then(() => {
        if (reason === "qr_timeout" || reason === "login_expired")
            discardUnlinkedProfile(entry);
    });
}
function scheduleQrRefresh(entry) {
    clearQrRefresh(entry);
    // Only reached while a human is at the linking screen (startLocalLine set
    // linkStartedAt); a QR with nobody watching is stopped in the qr handler
    // before it gets here. The page refreshing its own code is what gets us here
    // most of the time, so the wall clock is checked on every call and not only
    // when a relaunch is due.
    if (entry.linkStartedAt === null)
        entry.linkStartedAt = Date.now();
    if (Date.now() - entry.linkStartedAt >= LINK_WINDOW_MS) {
        blockLine(entry, "qr_timeout", "انتهت مهلة الربط — افتح صفحة الربط وابدأ من جديد.");
        return;
    }
    if (entry.qrRefreshes >= MAX_QR_REFRESHES) {
        // The customer opened the linking screen and walked away. Before this cap
        // existed, that cost a fresh Chromium launch and a fresh unauthenticated
        // WhatsApp Web registration handshake every sixty seconds until the process
        // restarted — registration abuse from one host, with no message ever sent.
        blockLine(entry, "qr_timeout", "انتهت مهلة الربط — افتح صفحة الربط وابدأ من جديد.");
        return;
    }
    entry.qrRefreshTimer = setTimeout(() => {
        entry.qrRefreshTimer = null;
        if (entry.snapshot.status !== "pending")
            return;
        entry.qrRefreshes += 1;
        if (entry.qrRefreshes >= MAX_QR_REFRESHES) {
            blockLine(entry, "qr_timeout", "انتهت مهلة الربط — افتح صفحة الربط وابدأ من جديد.");
            return;
        }
        void teardown(entry, { keepStatus: true, reason: "qr refresh" }).then(() => launch(entry, { force: true }));
    }, QR_REFRESH_MS);
    entry.qrRefreshTimer.unref?.();
}
/**
 * Arms the reconnect ladder.
 *
 * Three separate budgets, because they stop three separate things:
 *   - the exponential delay stops a tight relaunch loop;
 *   - MAX_RECONNECT_ATTEMPTS then puts the line to REST rather than declaring
 *     it dead, because "the server had no network for ten minutes" must not
 *     force every customer to re-scan a QR code;
 *   - DROP_BUDGET_PER_HOUR (counted in dropLog, deliberately NOT reset by a
 *     successful "ready") stops the flap cycle that consecutive-failure
 *     counting cannot see, and which is what registers session after session
 *     against the customer's account.
 */
function scheduleReconnect(entry, why) {
    if (shuttingDown || entry.block)
        return;
    const now = Date.now();
    entry.dropLog = entry.dropLog.filter((t) => now - t < HOUR_MS);
    if (entry.dropLog.length >= DROP_BUDGET_PER_HOUR) {
        blockLine(entry, "flapping", "خط واتساب هذا ينقطع ويعود بشكل متكرر، وأوقفناه حمايةً لرقمك من قيود واتساب. أعد ربط الرقم من الإعدادات، وتأكد من عدم فتح «واتساب ويب» لنفس الرقم في مكان آخر.");
        return;
    }
    const resting = entry.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS;
    const delay = resting ? RECONNECT_REST_MS : Math.min(RECONNECT_BASE_MS * 2 ** entry.reconnectAttempts, RECONNECT_MAX_MS);
    entry.reconnectAttempts += 1;
    entry.cooldownUntil = now + delay;
    if (resting) {
        setSnapshot(entry, {
            status: "error",
            error: `تعذّر الاتصال بواتساب على هذا الخط. سنحاول تلقائياً بعد ${Math.round(RECONNECT_REST_MS / 60_000)} دقيقة — أو أعد الربط من الإعدادات الآن.`,
        });
    }
    armReconnect(entry, delay, why);
}
function armReconnect(entry, delay, why) {
    clearReconnect(entry);
    entry.reconnectTimer = setTimeout(() => {
        entry.reconnectTimer = null;
        if (shuttingDown || entry.block)
            return;
        const now = Date.now();
        entry.reconnectLog = entry.reconnectLog.filter((t) => now - t < HOUR_MS);
        entry.reconnectLog.push(now);
        console.log(`[whatsapp] reconnecting ${describe(entry)} (${why}, attempt ${entry.reconnectAttempts})`);
        void launch(entry, { force: true });
    }, delay);
    entry.reconnectTimer.unref?.();
}
/**
 * Test seam. Never set in production — a test needs to drive the reconnect,
 * auth-failure and eviction paths, and none of them can be reached honestly
 * with a real Chromium in a plain `node` script.
 */
let clientFactory = null;
export function __setLocalSessionClientFactoryForTests(factory) {
    clientFactory = factory;
}
function buildClient(entry) {
    if (clientFactory)
        return clientFactory({ key: entry.key, linkPhoneNumber: entry.linkPhoneNumber });
    clearStaleLocks(entry.key);
    fs.mkdirSync(sessionsRoot(), { recursive: true });
    return new ClientCtor({
        // The session key, not the company id: this is what puts each line's login
        // in a directory of its own. For a main line the two are the same string,
        // which is why profiles linked before this existed are found where they
        // already are.
        authStrategy: new LocalAuth({ dataPath: sessionsRoot(), clientId: entry.key }),
        ...(entry.linkPhoneNumber ? { pairWithPhoneNumber: { phoneNumber: entry.linkPhoneNumber, showNotification: true } } : {}),
        puppeteer: {
            headless: true,
            // The Dockerfile installs Debian's chromium and points this at it, so
            // the image never depends on Puppeteer's own download step at build time.
            executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
            // Memory, disk and sandbox flags only. Nothing here changes how the
            // client identifies itself: no user-agent override, no proxy, no
            // fingerprint tricks — the platform does not hide what it is, it stops
            // doing the things that get numbers restricted.
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-component-update",
                "--disable-background-networking",
                // Caps the per-session on-disk cache. Uncapped Chromium caches are what
                // filled the volume last time.
                "--disk-cache-size=10485760",
                "--media-cache-size=10485760",
            ],
        },
    });
}
/**
 * Reasons a session ended that must NOT be reconnected.
 *
 * Every one of these is WhatsApp or the account's owner saying the session is
 * over. Racing to re-establish it is fighting the platform, and a client that
 * keeps re-registering after a CONFLICT or an UNPAIRED is exactly the
 * linked-device abuse pattern that gets the underlying number restricted.
 */
const TERMINAL_DISCONNECT = {
    LOGOUT: {
        reason: "logged_out",
        ar: "تم إلغاء الربط من تطبيق واتساب على الهاتف. امسح رمز QR من جديد لإعادة تشغيل المساعد على هذا الرقم.",
    },
    CONFLICT: {
        reason: "conflict",
        ar: "فُتحت جلسة «واتساب ويب» أخرى لنفس الرقم فأُغلقت جلستنا. أغلق الجلسة الأخرى ثم أعد الربط من الإعدادات — لا نحاول انتزاع الجلسة تلقائياً لأن ذلك يعرّض الرقم للتقييد.",
    },
    UNPAIRED: {
        reason: "unpaired",
        ar: "أُلغي ربط هذا الجهاز من إعدادات «الأجهزة المرتبطة» في واتساب. أعد الربط لتشغيل المساعد.",
    },
    UNPAIRED_IDLE: {
        reason: "unpaired",
        ar: "أُلغي ربط هذا الجهاز لعدم الاستخدام. أعد الربط لتشغيل المساعد.",
    },
    TOS_BLOCK: {
        reason: "restricted",
        ar: "قيّد واتساب هذا الرقم. أوقفنا كل المحاولات على هذا الخط فوراً — راجع تطبيق واتساب على الهاتف، وقدّم اعتراضاً إن رأيت ذلك مناسباً. لا نعيد المحاولة لأن ذلك يزيد الأمر سوءاً.",
    },
    SMB_TOS_BLOCK: {
        reason: "restricted",
        ar: "قيّد واتساب حساب الأعمال لهذا الرقم. أوقفنا كل المحاولات على هذا الخط — راجع تطبيق واتساب على الهاتف.",
    },
    DEPRECATED_VERSION: {
        reason: "unsupported",
        ar: "نسخة «واتساب ويب» المستخدمة لم تعد مدعومة، ولن نعيد المحاولة حتى يُحدَّث الخادم. أبلغ مشغّل الخادم.",
    },
    PROXYBLOCK: {
        reason: "restricted",
        ar: "حجب واتساب الاتصال القادم من هذا الخادم. أوقفنا المحاولات على هذا الخط وأبلغ مشغّل الخادم.",
    },
};
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
export function messageIdString(id) {
    if (typeof id === "string")
        return id || null;
    if (!id || typeof id !== "object")
        return null;
    const key = id;
    if (typeof key._serialized === "string" && key._serialized)
        return key._serialized;
    for (const value of Object.values(key)) {
        if (typeof value === "string" && /^(true|false)_[^_]+_[^_]+/.test(value))
            return value;
    }
    const wid = (v) => typeof v === "string" ? v : v && typeof v === "object" && typeof v._serialized === "string" ? (v._serialized) : null;
    const remote = wid(key.remote);
    const participant = wid(key.participant);
    if (!remote || typeof key.id !== "string" || !key.id)
        return null;
    return `${key.fromMe ? "true" : "false"}_${remote}_${key.id}${participant ? `_${participant}` : ""}`;
}
async function downloadMediaRaw(message) {
    const msgId = messageIdString(message.id);
    if (!msgId) {
        // Named for the log, because the page would only say "not a valid key".
        let shape = "unprintable";
        try {
            shape = JSON.stringify(message.id).slice(0, 160);
        }
        catch { }
        return { error: "message-id-unserialisable:" + shape };
    }
    const pupPage = message.client.pupPage;
    return pupPage
        .evaluate(async (msgId) => {
        const describeError = (e) => {
            try {
                if (e === null || e === undefined)
                    return "null-or-undefined-thrown";
                if (typeof e === "string")
                    return "string-thrown:" + e;
                const err = e;
                const parts = [];
                if (err.name)
                    parts.push("name=" + err.name);
                if (err.message)
                    parts.push("message=" + err.message);
                if (err.code !== undefined)
                    parts.push("code=" + err.code);
                if (err.status !== undefined)
                    parts.push("status=" + err.status);
                if (parts.length)
                    return parts.join(",");
                try {
                    return "json=" + JSON.stringify(e);
                }
                catch {
                    return "keys=" + Object.keys(e).join("|") + ",toString=" + String(e);
                }
            }
            catch {
                return "describe-itself-failed";
            }
        };
        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const w = window;
            let msg;
            try {
                msg = w.require("WAWebCollections").Msg.get(msgId);
                if (!msg) {
                    const res = await w.require("WAWebCollections").Msg.getMessagesById([msgId]);
                    msg = res && res.messages && res.messages[0];
                }
            }
            catch (e) {
                return { error: "lookup-threw:" + describeError(e) };
            }
            if (!msg)
                return { error: "message-not-found-in-store" };
            if (!msg.mediaData)
                return { error: "no-media-data-on-message" };
            // REUPLOADING means the media truly expired server-side (the download
            // button spins forever in the real WhatsApp Web UI too) — genuinely
            // unrecoverable, not something to retry past.
            if (msg.mediaData.mediaStage === "REUPLOADING")
                return { error: "media-expired-reuploading" };
            if (msg.mediaData.mediaStage !== "RESOLVED") {
                try {
                    await msg.downloadMedia({ downloadEvenIfExpensive: true, rmrReason: 1 });
                }
                catch (e) {
                    return { error: "resolve-step-threw:" + describeError(e) };
                }
            }
            const stage = msg.mediaData.mediaStage;
            if (!msg.directPath || !msg.mediaKey) {
                return { error: "missing-download-keys(directPath=" + !!msg.directPath + ",mediaKey=" + !!msg.mediaKey + ",stage=" + stage + ")" };
            }
            try {
                const mockQpl = {
                    addAnnotations() {
                        return this;
                    },
                    addPoint() {
                        return this;
                    },
                };
                const decryptedMedia = await w.require("WAWebDownloadManager").downloadManager.downloadAndMaybeDecrypt({
                    directPath: msg.directPath,
                    encFilehash: msg.encFilehash,
                    filehash: msg.filehash,
                    mediaKey: msg.mediaKey,
                    mediaKeyTimestamp: msg.mediaKeyTimestamp,
                    type: msg.type,
                    signal: new AbortController().signal,
                    downloadQpl: mockQpl,
                });
                const data = await w.WWebJS.arrayBufferToBase64Async(decryptedMedia);
                return { data, mimetype: msg.mimetype };
            }
            catch (e) {
                return { error: "decrypt-threw(stage=" + stage + "):" + describeError(e) };
            }
        }
        catch (e) {
            return { error: "outer-threw:" + describeError(e) };
        }
    }, msgId)
        .catch((e) => ({ error: "evaluate-boundary-threw:" + (e instanceof Error ? e.message : String(e)) }));
}
async function downloadMediaWithRetry(message, describeLine, attempts = 8, delayMs = 4285) {
    let lastReason = "no-attempts-ran";
    for (let i = 0; i < attempts; i++) {
        const result = await downloadMediaRaw(message);
        if (result.data)
            return { data: result.data, mimetype: result.mimetype };
        lastReason = result.error || "unknown-empty-result";
        console.log(`[whatsapp] voice note download attempt ${i + 1}/${attempts} failed on ${describeLine}: ${lastReason}`);
        if (i < attempts - 1)
            await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    return { data: null, failReason: lastReason };
}
function wireEvents(entry, client, generation) {
    // Every handler starts with this. whatsapp-web.js keeps emitting from a
    // client long after it has been replaced, and before this guard existed a
    // dead client's "disconnected" scheduled a relaunch for the LIVE one — the
    // compounding flap described in the header.
    const stale = () => entry.generation !== generation;
    // A QR (or pairing code) that nobody asked for.
    //
    // linkStartedAt is set by exactly one thing: startLocalLine, i.e. a human at
    // the linking screen. Every other launch — the boot resume, a send waking an
    // evicted line, the reconnect ladder — starts from a login saved on disk and
    // expects WhatsApp Web to resume it. When WhatsApp answers with a scan
    // request instead, the saved credentials are gone (the phone unlinked the
    // device, or the session sat unused past WhatsApp's expiry — the first
    // cutover found two companies whose logins had quietly died weeks earlier).
    // Nobody is looking at that QR, so it used to sit there through the whole
    // refresh budget: five Chromium relaunches and five fresh unauthenticated
    // registrations from this host, for a code no one could scan, ending in a
    // "linking timed out" message to a customer who never opened the linking
    // screen. Stopped on the first one instead, with the real reason.
    const unattended = (what) => {
        if (entry.linkStartedAt !== null)
            return false;
        console.warn(`[whatsapp] ${what} requested for ${describe(entry)} with nobody at the linking screen — the saved login no longer authenticates`);
        blockLine(entry, "login_expired", "انتهت صلاحية تسجيل الدخول المحفوظ لهذا الخط، وواتساب يطلب مسح رمز QR من جديد. أعد ربط الرقم من الإعدادات.");
        return true;
    };
    client.on("qr", async (qr) => {
        if (stale())
            return;
        if (unattended("a QR scan"))
            return;
        try {
            setSnapshot(entry, { status: "pending", qrDataUrl: await QRCode.toDataURL(qr), pairingCode: null, error: null });
            scheduleQrRefresh(entry);
        }
        catch (err) {
            setSnapshot(entry, { status: "error", error: err instanceof Error ? err.message : "تعذّر توليد رمز QR." });
        }
    });
    client.on("code", (code) => {
        if (stale())
            return;
        if (unattended("a pairing code"))
            return;
        setSnapshot(entry, { status: "pending", pairingCode: code, qrDataUrl: null, error: null });
    });
    // Fires the moment the phone confirms the scan; the full sync that follows
    // can still take a while. The refresh timer is cleared here rather than only
    // on "ready" — otherwise a slow sync gets a fresh QR forced on a customer who
    // has already scanned successfully.
    client.on("authenticated", () => {
        if (stale())
            return;
        clearQrRefresh(entry);
        entry.qrRefreshes = 0;
        entry.linkStartedAt = null;
        // The phone number was for THIS pairing. Left on the entry, a later
        // unattended relaunch of a dead login would ask WhatsApp for a fresh
        // pairing code — and push a "link this device" notification to the
        // customer's phone — before the handler above could stop it.
        entry.linkPhoneNumber = null;
        entry.authenticatedThisAttempt = true;
        setSnapshot(entry, { qrDataUrl: null, pairingCode: null });
    });
    client.on("ready", () => {
        if (stale())
            return;
        clearQrRefresh(entry);
        clearReconnect(entry);
        clearReadyWatch(entry);
        entry.qrRefreshes = 0;
        entry.linkStartedAt = null;
        entry.authenticatedThisAttempt = true;
        // Consecutive-failure counting resets here, and only here. dropLog does
        // NOT: a line that connects and drops in a cycle would otherwise reconnect
        // forever, which is the flap this file exists to stop.
        entry.reconnectAttempts = 0;
        entry.cooldownUntil = 0;
        entry.readyAt = Date.now();
        entry.lastActivityAt = Date.now();
        entry.lastState = "CONNECTED";
        entry.lastStateAt = Date.now();
        const phoneNumber = client.info?.wid?.user ?? null;
        setSnapshot(entry, { status: "connected", qrDataUrl: null, pairingCode: null, error: null, phoneNumber });
        console.log(`[whatsapp] local session connected for ${describe(entry)} (${phoneNumber ?? "unknown number"})`);
    });
    client.on("change_state", (state) => {
        if (stale())
            return;
        entry.lastState = state;
        entry.lastStateAt = Date.now();
        const terminal = TERMINAL_DISCONNECT[state];
        // CONFLICT and the TOS blocks arrive here as well as through
        // "disconnected", and sometimes only here. Reacting to the first of the two
        // is what stops a doomed session from spending the reconnect ladder.
        if (terminal && (state === "CONFLICT" || terminal.reason === "restricted" || terminal.reason === "unpaired")) {
            blockLine(entry, terminal.reason, terminal.ar);
        }
    });
    client.on("disconnected", (reason) => {
        if (stale())
            return;
        clearQrRefresh(entry);
        console.warn(`[whatsapp] local session disconnected for ${describe(entry)}: ${reason}`);
        entry.lastState = reason;
        entry.lastStateAt = Date.now();
        const terminal = TERMINAL_DISCONNECT[reason];
        if (terminal) {
            blockLine(entry, terminal.reason, terminal.ar);
            return;
        }
        void handleTransientDisconnect(entry, reason);
    });
    client.on("auth_failure", (message) => {
        if (stale())
            return;
        // An authentication failure is not a transient error: the credentials on
        // disk no longer authenticate, and every retry is one more unauthorised
        // registration attempt from this host against the customer's number. Stop,
        // and ask a human to re-link.
        console.error(`[whatsapp] auth failure for ${describe(entry)}: ${message}`);
        blockLine(entry, "auth_failure", "فشل تسجيل الدخول إلى واتساب على هذا الخط، ولن نعيد المحاولة تلقائياً. امسح رمز QR من جديد لإعادة ربط الرقم.");
    });
    client.on("message", async (message) => {
        if (stale())
            return;
        if (message.fromMe || message.from === "status@broadcast")
            return;
        // GROUPS, CHANNELS AND BROADCAST LISTS ARE NOT ANSWERED, EVER.
        //
        // Customers link their own working number, and that number sits in family
        // groups, supplier groups and neighbourhood groups. Before this filter a
        // group message became a conversation like any other and the AI replied
        // into the group. Unsolicited automated messages in group chats are among
        // the highest-weighted signals in WhatsApp's enforcement, group members
        // block and report far more readily than 1:1 recipients, and it also burnt
        // the auto-reply budget on chatter instead of real customers.
        //
        // Dropped here at the transport rather than downstream, so no part of the
        // pipeline ever learns a group JID exists.
        if (!ADDRESSABLE_JID.test(message.from)) {
            entry.ignoredGroupMessages += 1;
            if (entry.ignoredGroupMessages === 1) {
                console.log(`[whatsapp] ignoring group/channel traffic on ${describe(entry)} — the assistant never replies in groups`);
            }
            return;
        }
        entry.lastActivityAt = Date.now();
        // Two independent backlog checks, deliberately not collapsed into one:
        // WhatsApp Web replays everything that arrived while a session was offline
        // through the same "message" event as a live one, and trusting a single
        // signal here has already caused real damage once — auto-replies fired at
        // months-old personal chats on first sync.
        if (entry.readyAt && Date.now() - entry.readyAt < POST_READY_QUIET_MS)
            return;
        if (entry.readyAt && message.timestamp && message.timestamp * 1000 < entry.readyAt)
            return;
        const contact = await message.getContact().catch(() => null);
        const senderName = contact?.pushname || contact?.name || message.from;
        const lineRef = { sessionKey: entry.key, lineId: entry.lineId, label: entry.label };
        // Real voice note (recorded in-app, type "ptt") or a plain audio file
        // sent as an attachment (type "audio") — both carry real spoken content,
        // so both get downloaded and relayed as media rather than as the (empty)
        // text body a voice note actually has. Transcription itself happens in
        // manager.ts's deliverIncomingWhatsAppVoiceNote — this file only owns the
        // WhatsApp session, not the ElevenLabs key. This mirrors, feature for
        // feature, what the Connector transport has always done for the same
        // case (connector-core.js) — the local/QR transport simply never had its
        // own copy of this branch before, so a voice note arriving here fell
        // through to the plain-text path below as an empty body and got an
        // AI reply to nothing instead of a real transcript or an honest apology.
        if (message.hasMedia && (message.type === "ptt" || message.type === "audio")) {
            const media = await downloadMediaWithRetry(message, describe(entry));
            if (media.data) {
                incomingHandler?.(entry.companyId, { from: message.from, body: "", fromMe: false, senderName, isVoice: true, mediaBase64: media.data, mimeType: media.mimetype || "audio/ogg" }, lineRef);
            }
            else {
                console.error(`[whatsapp] failed to download voice note on ${describe(entry)}: ${media.failReason}`);
                incomingHandler?.(entry.companyId, { from: message.from, body: "", fromMe: false, senderName, isVoice: true, downloadFailed: true, failReason: media.failReason }, lineRef);
            }
            return;
        }
        incomingHandler?.(entry.companyId, {
            // The full raw JID (with its @c.us / @lid suffix) is what has to go back
            // into sendMessage(), so it is kept intact rather than normalised here.
            from: message.from,
            body: message.body ?? "",
            fromMe: false,
            senderName,
        }, 
        // Which line answered the phone. The company id alone no longer says it,
        // and the reply has to leave on the number it arrived on — answering an
        // employee's customer from the company's main number is a different
        // person picking up.
        lineRef);
    });
}
/**
 * A disconnect we are allowed to recover from.
 *
 * The teardown is the whole point: whatsapp-web.js leaves the dead client and
 * its Chromium running, and launch() used to build a second client straight on
 * top of the same LocalAuth profile — two browsers, one WhatsApp login, both
 * registered against the customer's account, and the customer's phone showing
 * repeated "WhatsApp Web is active" notifications.
 */
async function handleTransientDisconnect(entry, reason) {
    const wasReady = entry.readyAt !== null;
    // Both of these happen BEFORE the teardown is awaited, and that ordering is
    // the fix for two races a test caught:
    //
    //   - destroy() on a real browser takes seconds. A send arriving in that
    //     window used to find a cooldown of zero and launch a second client
    //     immediately — the exact stacking this whole path exists to prevent. A
    //     provisional cooldown makes every caller defer from the first instant;
    //     scheduleReconnect below replaces it with the authoritative one.
    //   - the status was written after the await, so a launch that slipped in
    //     during the teardown had its "connected" overwritten with "connecting"
    //     by this handler, leaving a live line that every send reported as down.
    setSnapshot(entry, { status: "connecting", qrDataUrl: null, pairingCode: null, error: null });
    entry.cooldownUntil = Date.now() + Math.min(RECONNECT_BASE_MS * 2 ** entry.reconnectAttempts, RECONNECT_MAX_MS);
    await teardown(entry, { keepStatus: true, reason: `disconnected: ${reason}` });
    if (blockOf(entry) || shuttingDown)
        return;
    // Somebody (a customer pressing re-link, most likely) already put a new
    // client in this slot while we were closing the old one. It owns the line
    // now; scheduling a reconnect on top of it would tear down a healthy session.
    if (entry.client)
        return;
    if (wasReady) {
        // Only sessions that actually reached "ready" count against the flap
        // budget: those are the ones that registered a real Web session and then
        // dropped it. A launch that never connected is a local problem and is
        // governed by the consecutive ladder instead.
        const now = Date.now();
        entry.dropLog = entry.dropLog.filter((t) => now - t < HOUR_MS);
        entry.dropLog.push(now);
    }
    scheduleReconnect(entry, reason);
}
async function launch(entry, opts = {}) {
    if (shuttingDown)
        return;
    if (entry.launching) {
        // An UNforced caller (a send arriving while the line is starting) wants
        // exactly this launch, and joining it is the whole point.
        if (!opts.force)
            return entry.launching;
        // A FORCED caller is different, and treating it the same was a real defect
        // reproduced against this file: a customer pressing re-link, and a
        // reconnect firing off the ladder, both tear the current client down and
        // then call launch(force). If the launch they just retired was still in
        // flight — which is the normal case when Chromium is taking the 30-50s it
        // took during the volume incident — handing back that dead promise meant
        // NOTHING relaunched. The line sat at "connecting" with no client and no
        // armed timer until some later send happened to wake it, and the linking
        // screen showed a spinner that could never resolve.
        //
        // So: wait for the retired launch to finish unwinding (it closes whatever
        // it built, because its generation is stale), then re-decide. Not
        // recursion for its own sake — entry.launching is cleared by then, so the
        // second pass is an ordinary launch.
        await entry.launching.catch(() => { });
        if (shuttingDown || entry.block || entry.client)
            return;
        return launch(entry, opts);
    }
    // A stopped line is stopped. Only an explicit customer action (startLocalLine)
    // clears a block — not a timer, and never a send.
    if (entry.block) {
        setSnapshot(entry, { error: entry.block.ar });
        return;
    }
    // NEVER a second client on one LocalAuth profile. This is the single most
    // important line in the file: two whatsapp-web.js clients sharing one profile
    // means one WhatsApp account holding two Web sessions from one host, which is
    // a linked-device violation and reads as an automation harness.
    if (entry.client)
        return;
    const now = Date.now();
    if (!opts.force && now < entry.cooldownUntil) {
        // THE BACKOFF SURVIVES THE CALLER. Before this, the ladder lived only in
        // the disconnect handler: every send that found the line down called
        // launch() again immediately, so a queue of sends relaunched Chromium at
        // send cadence with no backoff at all. A caller that arrives during the
        // cooldown gets the already-armed retry, not a new one.
        if (!entry.reconnectTimer)
            armReconnect(entry, entry.cooldownUntil - now, "deferred by cooldown");
        return;
    }
    const live = [...sessions.values()].filter((s) => s.client);
    if (live.length >= MAX_CONCURRENT_SESSIONS) {
        setSnapshot(entry, {
            status: "error",
            error: `تم بلوغ الحد الأقصى لجلسات واتساب المتزامنة (${MAX_CONCURRENT_SESSIONS}) على هذا الخادم.`,
        });
        return;
    }
    if (live.filter((s) => s.companyId === entry.companyId).length >= MAX_LINES_PER_COMPANY) {
        // Logged as well as shown, because the two readers need different things:
        // the customer needs to know which of their own lines to free, the operator
        // needs to know which knob raises the ceiling.
        console.warn(`[whatsapp] ${entry.companyId} is at its per-company line cap (${MAX_LINES_PER_COMPANY}); raise WHATSAPP_MAX_LINES_PER_COMPANY if this box has the memory for it`);
        setSnapshot(entry, {
            status: "error",
            error: `تم بلوغ الحد الأقصى لخطوط واتساب لهذه الشركة (${MAX_LINES_PER_COMPANY}). افصل خطاً غير مستخدم أو راجع مشغّل الخادم لرفع الحد.`,
        });
        return;
    }
    setSnapshot(entry, { status: "connecting", error: null });
    // The slot this launch was asked for. Every teardown retires the slot, so
    // comparing it below is how a launch still waiting in the queue learns that
    // what it was asked to do no longer applies — the customer closed the link
    // modal, or pressed re-link, or the line was disconnected. Checking only
    // block/client was not enough: after a cancel both of those are null, so the
    // queued launch went ahead and opened a browser (and a fresh unauthenticated
    // registration) for an attempt nobody was waiting on any more.
    const requestedGeneration = entry.generation;
    const work = enqueueLaunch(async () => {
        // The queue can hold a launch for a long time behind another company's slow
        // Chromium start. Anything could have happened meanwhile — the line was
        // disconnected, blocked, cancelled, or the process is shutting down — so
        // the decision to launch is re-taken here rather than trusted from before
        // the wait.
        if (shuttingDown || entry.block || entry.client)
            return;
        if (entry.generation !== requestedGeneration)
            return;
        const generation = ++entry.generation;
        // Reset per LAUNCH, not per linking attempt: what discardUnlinkedProfile
        // needs to know is whether the client that is running right now got in.
        entry.authenticatedThisAttempt = false;
        let client = null;
        try {
            client = buildClient(entry);
            entry.client = client;
            wireEvents(entry, client, generation);
            await client.initialize();
            if (entry.generation !== generation) {
                // Torn down while we were starting. Close what we built instead of
                // leaving an orphan Chromium holding this line's WhatsApp login — an
                // orphan is invisible to MAX_CONCURRENT_SESSIONS and stays registered
                // against the customer's account until the process dies.
                await closeClient(client, describe(entry));
            }
            else if (entry.readyAt === null && entry.snapshot.status === "connecting") {
                // initialize() came back, nothing has spoken yet. Usually "ready" is
                // seconds away; when it never comes, this is what notices.
                watchForReady(entry, generation);
            }
        }
        catch (err) {
            if (entry.generation === generation)
                entry.client = null;
            if (client)
                await closeClient(client, describe(entry));
            const message = err instanceof Error ? err.message : "تعذّر تشغيل جلسة واتساب.";
            console.error(`[whatsapp] launch failed for ${describe(entry)}:`, err);
            if (entry.generation === generation && !entry.block) {
                setSnapshot(entry, { status: "error", error: message });
                // Arm the ladder from the failure itself. Leaving it to the next caller
                // is what produced relaunch-per-send; the caller now waits on this.
                scheduleReconnect(entry, "launch failed");
            }
        }
    }).finally(() => {
        entry.launching = null;
    });
    entry.launching = work;
    return work;
}
async function closeClient(client, who) {
    // destroy() ends the WhatsApp Web socket and closes the browser. Doing it
    // properly matters: an abrupt process kill leaves the session half-open from
    // WhatsApp's side, and repeating that on every deploy is noise WhatsApp can
    // see. Bounded, because a wedged browser must not hold a deploy open.
    try {
        await withTimeout(Promise.resolve(client.destroy()), CLOSE_TIMEOUT_MS, "whatsapp client destroy");
    }
    catch (err) {
        console.warn(`[whatsapp] destroy failed for ${who}:`, err instanceof Error ? err.message : err);
    }
}
async function teardown(entry, opts = {}) {
    clearQrRefresh(entry);
    clearReconnect(entry);
    clearReadyWatch(entry);
    // Retires the current client slot: every handler wired to the old client goes
    // quiet from this instant, and a launch still in flight will close whatever
    // it built instead of installing it.
    entry.generation += 1;
    const client = entry.client;
    entry.client = null;
    entry.readyAt = null;
    if (!opts.keepStatus)
        setSnapshot(entry, { ...DISCONNECTED });
    if (!client)
        return;
    await closeClient(client, describe(entry));
}
// --- public API ------------------------------------------------------------
/**
 * Opens (or reuses) a local WhatsApp Web session for one line and returns as
 * soon as there is something worth showing — a QR, a pairing code, a
 * connection, or an error.
 *
 * This is the one entry point that clears a block, because it is the one that
 * only happens when a human asks for it.
 */
export async function startLocalLine(ref, linkPhoneNumber) {
    const entry = entryFor(ref);
    entry.lastActivityAt = Date.now();
    entry.linkPhoneNumber = linkPhoneNumber ?? null;
    if (entry.client && entry.snapshot.status === "connected")
        return entry.snapshot;
    if (entry.client)
        await teardown(entry, { keepStatus: true, reason: "restart requested" });
    entry.block = null;
    entry.reconnectAttempts = 0;
    entry.qrRefreshes = 0;
    // A human is at the linking screen right now, so the window starts here.
    entry.linkStartedAt = Date.now();
    entry.cooldownUntil = 0;
    entry.consecutiveSendFailures = 0;
    entry.lastErrorAr = null;
    // dropLog is deliberately NOT cleared: if a line has been flapping, a re-link
    // is worth a try, but the hour's history stays so a still-broken line stops
    // again quickly instead of starting the whole budget over.
    void launch(entry, { force: true });
    // Chromium takes tens of seconds to produce a first QR. Waiting here rather
    // than returning "connecting" immediately means the UI shows a code on the
    // first response in the common case, instead of an empty modal that only
    // fills in on a later poll.
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
        const s = entry.snapshot;
        if (s.status === "connected" || s.status === "error" || s.qrDataUrl || s.pairingCode)
            return s;
        await sleep(250);
    }
    return entry.snapshot;
}
export async function startLocalSession(companyId, linkPhoneNumber) {
    return startLocalLine({ companyId }, linkPhoneNumber);
}
export async function stopLocalLine(ref) {
    // An id too malformed to name a key cannot have a session either, so this is
    // a no-op rather than a throw — a disconnect that fails loudly on the way out
    // just leaves the caller unable to finish tearing anything down.
    const key = lookupKey(ref);
    if (!key)
        return;
    const entry = sessions.get(key);
    if (entry) {
        // Stop anything armed before we start closing, so a reconnect timer cannot
        // fire against an entry that is being removed.
        clearQrRefresh(entry);
        clearReconnect(entry);
        entry.block = { reason: "logged_out", ar: "تم فصل الربط.", at: Date.now() };
        const client = entry.client;
        // logout() clears the saved credentials so the next start really does ask for
        // a fresh scan — destroy() alone would leave the login on disk and silently
        // reconnect, which is not what "disconnect" means to the person clicking it.
        // It deletes this key's profile directory and only that one, so disconnecting
        // an employee's line cannot take the company's main login down with it.
        if (client)
            await withTimeout(Promise.resolve(client.logout()), CLOSE_TIMEOUT_MS, "whatsapp logout").catch(() => { });
        await teardown(entry, { reason: "disconnect requested" });
        sessions.delete(key);
    }
    // A line with no browser up right now — evicted for idleness, or this
    // process has restarted since it was last used — still has its login on
    // disk, and that login is what the next send would silently relaunch. A
    // disconnect that leaves it there is the platform reconnecting a number the
    // customer just told it to let go of. No client means no logout() call, so
    // the phone keeps listing the device until the customer removes it there;
    // the platform side, at least, is honestly unlinked.
    if (hasSavedProfile(key)) {
        try {
            fs.rmSync(profileDir(key), { recursive: true, force: true });
            console.log(`[whatsapp] removed the saved login for ${key} on disconnect (no browser was running for it)`);
        }
        catch (err) {
            console.warn(`[whatsapp] could not remove the saved login for ${key}:`, err instanceof Error ? err.message : err);
        }
    }
}
export async function stopLocalSession(companyId) {
    await stopLocalLine({ companyId });
}
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
export async function cancelLocalLineLinking(ref) {
    const key = lookupKey(ref);
    const entry = key ? sessions.get(key) : null;
    if (!entry)
        return false;
    // The scan succeeded while the modal was closing. Tearing this down would be
    // the platform disconnecting a line the customer just linked.
    if (entry.snapshot.status === "connected")
        return false;
    if (!entry.client && !entry.launching && entry.snapshot.status !== "pending" && entry.snapshot.status !== "connecting")
        return false;
    // A QR on screen is proof there are no working credentials on disk — WhatsApp
    // Web would have resumed instead of asking — so the half-built profile goes
    // with the attempt. Without that, the abandoned directory reads as "linked"
    // to the next boot and buys a fresh round of registration handshakes.
    const wasPending = entry.snapshot.status === "pending";
    console.log(`[whatsapp] linking attempt cancelled for ${describe(entry)} by the customer`);
    setSnapshot(entry, { status: "disconnected", qrDataUrl: null, pairingCode: null, error: null });
    entry.qrRefreshes = 0;
    entry.linkStartedAt = null;
    entry.reconnectAttempts = 0;
    entry.cooldownUntil = 0;
    await teardown(entry, { keepStatus: true, reason: "linking cancelled" });
    if (wasPending)
        discardUnlinkedProfile(entry);
    return true;
}
export async function cancelLocalSessionLinking(companyId) {
    return cancelLocalLineLinking({ companyId });
}
/**
 * Ensures a line is live, relaunching a saved-but-evicted one on demand.
 *
 * Deliberately does NOT force a launch. A caller arriving while the ladder is
 * resting waits for the armed retry (and gives up at its own deadline) instead
 * of starting a fresh Chromium — that difference is what turns "the line is
 * down" from a relaunch per send into one relaunch per backoff step.
 */
async function ensureConnected(ref) {
    const entry = entryFor(ref);
    if (entry.client && entry.snapshot.status === "connected")
        return entry;
    if (entry.block) {
        // Named for the customer, not for the log: this is the sentence that has to
        // explain why nothing is being sent.
        throw new Error(entry.block.ar);
    }
    // Fail fast while the ladder is resting instead of holding the caller for the
    // full deadline. The caller learns how long the wait is, in Arabic, so a
    // message can be deferred and retried deliberately rather than being dropped
    // after a minute of silence — and so nothing is tempted to relaunch.
    const waitMs = entry.cooldownUntil - Date.now();
    if (!entry.client && waitMs > 30_000) {
        throw new Error(`جلسة واتساب لهذا الخط متوقفة مؤقتاً بعد تعذّر الاتصال؛ ستُعاد المحاولة تلقائياً خلال ${Math.ceil(waitMs / 60_000)} دقيقة.`);
    }
    if (!hasSavedProfile(entry.key)) {
        // Named per line, because "WhatsApp is not linked" sends the owner to the
        // company settings page to look at a link that is perfectly fine, when what
        // is missing is the employee's own number.
        throw new Error(entry.lineId
            ? "رقم واتساب الخاص بهذا الموظف غير مربوط — امسح رمز QR الخاص به أولاً."
            : "WhatsApp غير مربوط لهذه الشركة — امسح رمز QR أولاً.");
    }
    await launch(entry);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
        if (entry.client && entry.snapshot.status === "connected")
            return entry;
        // Re-checked every pass: an auth failure or a CONFLICT arriving while we
        // wait means this line has stopped, and the caller must be told that rather
        // than sitting out the full deadline.
        const block = blockOf(entry);
        if (block)
            throw new Error(block.ar);
        // An error with no retry armed and no launch running is final for this
        // caller. An error with a retry armed is worth waiting out.
        if (entry.snapshot.status === "error" && !entry.reconnectTimer && !entry.launching) {
            throw new Error(entry.snapshot.error ?? "تعذّر تشغيل جلسة واتساب.");
        }
        await sleep(250);
    }
    throw new Error("انتهت مهلة تشغيل جلسة واتساب.");
}
/**
 * Runs one operation against the line's live client.
 *
 * Two things this fixes. First, the client is captured once: the send paths
 * used to re-read `entry.client!` after an await, so a disconnect or an
 * eviction landing in between turned a customer's message into a TypeError on a
 * null client. Second, inFlightSends is what makes eviction safe — the idle
 * sweep and the shutdown path both refuse to close a line with a message on the
 * wire, so nothing is ever torn down mid-protocol.
 */
async function withSend(entry, work) {
    const client = entry.client;
    if (!client)
        throw new Error("جلسة واتساب لهذا الخط ليست متصلة الآن.");
    entry.inFlightSends += 1;
    entry.lastActivityAt = Date.now();
    try {
        const result = await work(client);
        entry.lastSendOkAt = Date.now();
        entry.lastActivityAt = entry.lastSendOkAt;
        entry.consecutiveSendFailures = 0;
        return result;
    }
    catch (err) {
        entry.consecutiveSendFailures += 1;
        entry.lastSendFailedAt = Date.now();
        entry.lastErrorAr = err instanceof Error ? err.message : "فشل إرسال رسالة واتساب.";
        throw err;
    }
    finally {
        entry.inFlightSends -= 1;
    }
}
export async function sendLocalLineText(ref, phone, text, typingDelayMs = 0) {
    // Resolved before the session is touched, so a group JID never gets as far as
    // launching a browser.
    const jid = toJid(phone);
    const entry = await ensureConnected(ref);
    await withSend(entry, async (client) => {
        // Send pacing, applied inside the in-flight window on purpose: the pause is
        // part of the send, and eviction must not close the browser during it. It
        // is spacing between messages leaving this number and nothing else — the
        // platform does not disguise what it is (see the file header).
        if (typingDelayMs > 0)
            await sleep(typingDelayMs);
        await client.sendMessage(jid, text);
    });
}
export async function sendLocalText(companyId, phone, text, typingDelayMs = 0) {
    await sendLocalLineText({ companyId }, phone, text, typingDelayMs);
}
export async function sendLocalLineMedia(ref, phone, file, mimeType, filename, asDocument) {
    const jid = toJid(phone);
    const entry = await ensureConnected(ref);
    await withSend(entry, async (client) => {
        const media = new MessageMedia(mimeType, file.toString("base64"), filename);
        await client.sendMessage(jid, media, { sendMediaAsDocument: asDocument });
    });
}
export async function sendLocalMedia(companyId, phone, file, mimeType, filename, asDocument) {
    await sendLocalLineMedia({ companyId }, phone, file, mimeType, filename, asDocument);
}
export async function sendLocalLineVoice(ref, phone, audio, mimeType, typingDelayMs = 0) {
    const jid = toJid(phone);
    const entry = await ensureConnected(ref);
    await withSend(entry, async (client) => {
        if (typingDelayMs > 0)
            await sleep(typingDelayMs);
        const media = new MessageMedia(mimeType, audio.toString("base64"), "voice.ogg");
        await client.sendMessage(jid, media, { sendAudioAsVoice: true });
    });
}
export async function sendLocalVoice(companyId, phone, audio, mimeType, typingDelayMs = 0) {
    await sendLocalLineVoice({ companyId }, phone, audio, mimeType, typingDelayMs);
}
// --- housekeeping ----------------------------------------------------------
let sweepTimer = null;
let pulseTimer = null;
let shuttingDown = false;
/**
 * Closes sessions nobody has used for a while. Their logins stay on disk, so a
 * later send relaunches transparently — this reclaims the ~350 MB of resident
 * Chromium, not the account link.
 */
function sweepIdleSessions() {
    const now = Date.now();
    for (const entry of sessions.values()) {
        if (!entry.client)
            continue;
        if (entry.snapshot.status === "pending")
            continue; // someone is mid-scan
        // A launch in flight is not idle, whatever lastActivityAt says, and closing
        // one mid-start is how a half-built client gets orphaned.
        if (entry.launching)
            continue;
        // Never under a send. lastActivityAt is refreshed at the start of a send so
        // this is belt and braces, but "belt and braces" here means a customer's
        // message is not cut off in the middle of the protocol.
        if (entry.inFlightSends > 0)
            continue;
        if (now - entry.lastActivityAt < IDLE_EVICT_MS)
            continue;
        console.log(`[whatsapp] evicting idle session for ${describe(entry)}`);
        // Eviction is our own decision, not a fault: keep the phone number visible
        // so the customer still sees which number is linked, and do not count it
        // against the flap budget.
        //
        // The status is written BEFORE the teardown is awaited. Written after, a
        // send that relaunched the line while the old browser was still closing had
        // its "connected" overwritten with "disconnected" — a live line that every
        // subsequent send reported as down until the process restarted.
        setSnapshot(entry, { status: "disconnected", qrDataUrl: null, pairingCode: null, error: null });
        void teardown(entry, { keepStatus: true, reason: "idle" });
    }
}
/**
 * Asks each live page what state WhatsApp thinks it is in.
 *
 * getState() reads Store.AppState out of the already-open page — no WhatsApp
 * round trip, so this is free to do every minute. It exists because a session
 * whose browser is alive but whose page has died is otherwise invisible until a
 * customer's message fails to send, and because CONFLICT / UNPAIRED / TOS_BLOCK
 * sometimes only ever show up here.
 */
async function pulseSessionHealth() {
    for (const entry of sessions.values()) {
        if (shuttingDown)
            return;
        const client = entry.client;
        if (!client || entry.launching || entry.snapshot.status !== "connected")
            continue;
        const generation = entry.generation;
        let state = null;
        try {
            state = (await withTimeout(Promise.resolve(client.getState()), STATE_PROBE_TIMEOUT_MS, "whatsapp getState"));
        }
        catch (err) {
            if (entry.generation !== generation)
                continue;
            console.warn(`[whatsapp] health probe failed for ${describe(entry)}:`, err instanceof Error ? err.message : err);
            // The page is gone even though the browser is not. Close it properly and
            // let the ladder decide whether to come back — leaving it would keep a
            // zombie Web session registered against the customer's number.
            entry.lastState = null;
            entry.lastStateAt = Date.now();
            await handleTransientDisconnect(entry, "health probe failed");
            continue;
        }
        if (entry.generation !== generation)
            continue;
        entry.lastState = state;
        entry.lastStateAt = Date.now();
        const terminal = state ? TERMINAL_DISCONNECT[state] : undefined;
        if (terminal) {
            blockLine(entry, terminal.reason, terminal.ar);
        }
    }
}
export function startLocalSessionHousekeeping() {
    installShutdownClose();
    if (sweepTimer)
        return;
    sweepTimer = setInterval(sweepIdleSessions, SWEEP_INTERVAL_MS);
    pulseTimer = setInterval(() => void pulseSessionHealth(), HEALTH_PULSE_MS);
    // Never hold the process open for these alone.
    sweepTimer.unref?.();
    pulseTimer.unref?.();
}
export function stopLocalSessionHousekeeping() {
    if (sweepTimer)
        clearInterval(sweepTimer);
    if (pulseTimer)
        clearInterval(pulseTimer);
    sweepTimer = null;
    pulseTimer = null;
}
// --- shutdown --------------------------------------------------------------
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
export async function closeAllLocalSessions(why) {
    const entries = [...sessions.values()].filter((e) => e.client);
    if (entries.length === 0)
        return;
    console.log(`[whatsapp] closing ${entries.length} local session(s) — ${why}`);
    await Promise.all(entries.map(async (entry) => {
        const drainUntil = Date.now() + IN_FLIGHT_DRAIN_MS;
        while (entry.inFlightSends > 0 && Date.now() < drainUntil)
            await sleep(50);
        await teardown(entry, { keepStatus: true, reason: why });
    }));
}
/**
 * Run before any session is closed, when the process is going down.
 *
 * Exists for exactly one caller: the outbound queue, which has to stop handing
 * new messages to a transport that is about to disappear and let anything
 * already on the wire settle — a message killed mid-send is journalled as
 * "sending" and, on the next boot, is neither resent nor delivered.
 *
 * A setter rather than an import because manager.ts imports THIS module; an
 * import back would be a cycle. Bounded by the caller's own budget below,
 * because a hook that hangs turns a graceful stop into the SIGKILL this whole
 * section exists to avoid.
 */
let preShutdownHook = null;
export function onLocalSessionShutdown(fn) {
    preShutdownHook = fn;
}
const PRE_SHUTDOWN_BUDGET_MS = 3_000;
/**
 * Everything that has to happen before the process ends, in the order it has to
 * happen in: stop the timers, let the queue quiesce and drain what is on the
 * wire, THEN close the browsers those sends were using. Closing first would cut
 * under the very messages the drain exists to save.
 *
 * Separated from the signal handler so the ordering is something a test can
 * assert rather than something a reader has to trust — the wiring is a setter
 * registered by another module, which is exactly the kind of thing that
 * silently stops firing.
 */
async function runShutdownSequence(why) {
    // Every timer in this module is unref'd so that none of them holds the
    // process open during normal running. That is right, and it turns into a trap
    // here: the timeouts guarding the shutdown are unref'd too, so once the
    // housekeeping timers are cleared, a hook that hangs can leave Node with an
    // empty event loop. Node then exits cleanly IN THE MIDDLE of the sequence and
    // no session is ever closed — the half-open WhatsApp Web sessions this whole
    // path exists to avoid, arrived at by tidiness rather than by a kill. One
    // ref'd timer holds the loop open until the sequence is actually done.
    const keepAlive = setInterval(() => { }, 1_000);
    try {
        stopLocalSessionHousekeeping();
        if (preShutdownHook) {
            try {
                await withTimeout(preShutdownHook(why), PRE_SHUTDOWN_BUDGET_MS, "whatsapp pre-shutdown");
            }
            catch (err) {
                console.warn("[whatsapp] pre-shutdown hook did not finish in time:", err instanceof Error ? err.message : err);
            }
        }
        try {
            await withTimeout(closeAllLocalSessions(why), SHUTDOWN_GRACE_MS, "whatsapp shutdown");
        }
        catch (err) {
            console.warn("[whatsapp] shutdown did not finish in time:", err instanceof Error ? err.message : err);
        }
    }
    finally {
        clearInterval(keepAlive);
    }
}
async function shutdownOnSignal(signal) {
    if (shuttingDown)
        return;
    shuttingDown = true;
    await runShutdownSequence(`process received ${signal}`);
    // Node's default action for these signals is to terminate, and registering
    // ANY listener replaces it. store-persistence.ts also registers one and
    // deliberately declines to exit when it is not the only listener (its own
    // flush is synchronous and has already run by the time we get here), so the
    // exit is ours to make. Without it `docker compose stop` waits out its full
    // grace period and then SIGKILLs — the abrupt kill this function exists to
    // avoid.
    process.exit(0);
}
function installShutdownClose() {
    const g = globalThis;
    if (g.__platformWhatsAppShutdownInstalled)
        return; // dev HMR re-evaluates this module
    g.__platformWhatsAppShutdownInstalled = true;
    for (const signal of ["SIGTERM", "SIGINT"]) {
        process.on(signal, () => void shutdownOnSignal(signal));
    }
}
// --- health ----------------------------------------------------------------
function minutesSince(at, now) {
    return at === null ? null : Math.round((now - at) / 60_000);
}
function summariseAr(h) {
    if (h.blockReason)
        return h.lastErrorAr ?? "هذا الخط متوقف ويحتاج إعادة ربط.";
    if (h.status === "pending")
        return "بانتظار مسح رمز QR من تطبيق واتساب على الهاتف.";
    if (h.status === "connecting")
        return "جارٍ تشغيل الاتصال بواتساب…";
    if (h.status === "error")
        return h.lastErrorAr ?? "هناك خطأ في هذا الخط.";
    if (h.status === "connected") {
        if (h.flapping) {
            return `الخط متصل لكنه انقطع ${h.dropsLastHour} مرات في آخر ساعة — إن تكرّر ذلك سنوقفه تلقائياً حمايةً للرقم. تأكد من عدم فتح «واتساب ويب» لنفس الرقم في مكان آخر.`;
        }
        if (h.consecutiveSendFailures >= 3) {
            return `الخط متصل لكن آخر ${h.consecutiveSendFailures} رسائل فشلت. راجع آخر خطأ أدناه.`;
        }
        return h.uptimeMinutes !== null ? `الخط متصل منذ ${h.uptimeMinutes} دقيقة.` : "الخط متصل.";
    }
    if (h.linked)
        return "الرقم مربوط والخط غير مُشغَّل الآن — سيعمل تلقائياً عند أول رسالة.";
    return "لا يوجد رقم واتساب مربوط بهذا الخط.";
}
function healthOf(entry, now) {
    const dropsLastHour = entry.dropLog.filter((t) => now - t < HOUR_MS).length;
    const reconnectsLastHour = entry.reconnectLog.filter((t) => now - t < HOUR_MS).length;
    const base = {
        sessionKey: entry.key,
        companyId: entry.companyId,
        lineId: entry.lineId,
        isMainLine: entry.lineId === null,
        // Falls back to the raw line id rather than something friendlier: an
        // unlabelled line is still one a human has to be able to point at.
        label: entry.label ?? entry.lineId ?? "الخط الرئيسي",
        status: entry.snapshot.status,
        phoneNumber: entry.snapshot.phoneNumber,
        live: Boolean(entry.client && entry.snapshot.status === "connected"),
        linked: hasSavedProfile(entry.key),
        uptimeMinutes: minutesSince(entry.readyAt, now),
        idleMinutes: Math.round((now - entry.lastActivityAt) / 60_000),
        lastSuccessfulSendAt: entry.lastSendOkAt,
        minutesSinceLastSuccessfulSend: minutesSince(entry.lastSendOkAt, now),
        consecutiveSendFailures: entry.consecutiveSendFailures,
        reconnectsLastHour,
        dropsLastHour,
        // Half the budget is the point at which a human should be looking at it,
        // rather than the point at which the platform gives up.
        flapping: dropsLastHour >= Math.max(2, Math.ceil(DROP_BUDGET_PER_HOUR / 2)),
        needsRelink: entry.block !== null,
        blockReason: entry.block?.reason ?? null,
        phoneReachable: entry.lastState === null ? null : entry.lastState === "CONNECTED",
        lastKnownState: entry.lastState,
        ignoredGroupMessages: entry.ignoredGroupMessages,
        lastErrorAr: entry.block?.ar ?? entry.snapshot.error ?? entry.lastErrorAr,
    };
    return { ...base, summaryAr: summariseAr(base) };
}
/**
 * The health of one line, for the customer's own integrations screen.
 *
 * A line that is flapping, resting on the reconnect ladder, or stopped and
 * waiting to be re-linked used to be invisible until a message silently failed
 * to arrive. Returns null for a line this process has never held a session for
 * — the caller should fall back to "linked / not linked" from disk.
 */
export function getLocalLineHealth(ref) {
    const key = lookupKey(ref);
    const entry = key ? sessions.get(key) : null;
    if (!entry)
        return null;
    return healthOf(entry, Date.now());
}
/** Every line this process holds a session entry for. */
export function localLineHealth() {
    const now = Date.now();
    return [...sessions.values()].map((entry) => healthOf(entry, now));
}
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
export function localSessionStats() {
    return localLineHealth();
}
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
export async function isLocalLineWhatsAppNumber(ref, phone) {
    const digits = phone.replace(/\D/g, "");
    // Nothing shorter than a country code plus a subscriber number can be a real
    // account, and asking WhatsApp about it just wastes a round trip.
    if (digits.length < 8)
        return false;
    const key = lookupKey(ref);
    const existing = key ? sessions.get(key) : null;
    const now = Date.now();
    // Answer from memory when we asked recently. getNumberId is a contact-
    // existence query, and WhatsApp scores enumeration separately from messaging:
    // a caller loop that re-asks about the same dead number every sixty seconds
    // (which has happened, and for weeks) must cost exactly one query, not 1,440
    // a day. reachability.ts caches the same answer above this; this is the
    // backstop for callers that reach the transport directly.
    const memo = existing?.lookupMemo.get(digits);
    if (memo && now - memo.at < LOOKUP_MEMO_MS)
        return memo.value;
    if (existing) {
        existing.lookupLog = existing.lookupLog.filter((t) => now - t < HOUR_MS);
        if (existing.lookupLog.length >= LOOKUP_BUDGET_PER_HOUR) {
            // Something upstream is looping. Answering "unknown" keeps the documented
            // contract (a caller must not read null as "no"), and the count is on the
            // health view so the owner can see which line is being hammered.
            console.warn(`[whatsapp] contact lookup budget reached on ${describe(existing)} (${existing.lookupLog.length}/h) — refusing further lookups this hour`);
            return null;
        }
    }
    try {
        const entry = await ensureConnected(ref);
        entry.lastActivityAt = Date.now();
        entry.lookupLog = entry.lookupLog.filter((t) => Date.now() - t < HOUR_MS);
        entry.lookupLog.push(Date.now());
        const id = await entry.client.getNumberId(digits);
        const value = id !== null && id !== undefined;
        entry.lookupMemo.set(digits, { value, at: Date.now() });
        return value;
    }
    catch {
        // Remembered as "unknown" so a burst of retries does not turn one broken
        // lookup into a burst of queries; the short memo TTL lets a line that comes
        // back answer properly soon after.
        existing?.lookupMemo.set(digits, { value: null, at: Date.now() });
        return null;
    }
}
export async function isLocalWhatsAppNumber(companyId, phone) {
    return isLocalLineWhatsAppNumber({ companyId }, phone);
}
/** Test seam. Never called in production. */
export function __resetLocalSessionsForTests() {
    for (const entry of sessions.values()) {
        clearQrRefresh(entry);
        clearReconnect(entry);
    }
    sessions.clear();
    launchChain = Promise.resolve();
    shuttingDown = false;
}
/** Test seam. Never called in production — the sweep is on a 15-minute timer. */
export function __sweepIdleSessionsForTests() {
    sweepIdleSessions();
}
/**
 * Test seam. Never called in production.
 *
 * Runs everything a SIGTERM runs except the process.exit that follows it, so
 * the ordering (queue first, browsers second) is asserted rather than assumed.
 */
export async function __runShutdownSequenceForTests(why = "test") {
    await runShutdownSequence(why);
}
/** Test seam. Never called in production — the pulse is on a 60-second timer. */
export async function __pulseSessionHealthForTests() {
    await pulseSessionHealth();
}
/**
 * Test seam. Never called in production.
 *
 * Moves a line's clocks backwards so idle eviction and the post-ready quiet
 * window can be exercised without a test that sleeps for three hours.
 */
export function __ageLocalSessionForTests(ref, ms) {
    const key = lookupKey(ref);
    const entry = key ? sessions.get(key) : null;
    if (!entry)
        return;
    if (entry.readyAt !== null)
        entry.readyAt -= ms;
    entry.lastActivityAt -= ms;
}
/** Test seam. Never called in production. */
export function __inspectLocalSessionForTests(ref) {
    const key = lookupKey(ref);
    const entry = key ? sessions.get(key) : null;
    if (!entry)
        return null;
    return {
        hasClient: entry.client !== null,
        status: entry.snapshot.status,
        generation: entry.generation,
        reconnectArmed: entry.reconnectTimer !== null,
        qrRefreshArmed: entry.qrRefreshTimer !== null,
        readyWatchArmed: entry.readyTimer !== null,
        dropsLastHour: entry.dropLog.filter((t) => Date.now() - t < HOUR_MS).length,
        qrRefreshes: entry.qrRefreshes,
        reconnectAttempts: entry.reconnectAttempts,
        cooldownRemainingMs: Math.max(0, entry.cooldownUntil - Date.now()),
        blockReason: entry.block?.reason ?? null,
        inFlightSends: entry.inFlightSends,
        ignoredGroupMessages: entry.ignoredGroupMessages,
    };
}
//# sourceMappingURL=session.js.map