import fs from "fs";
import path from "path";
// --- policy ----------------------------------------------------------------
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
export const OUTBOX_POLICY = {
    // Generous on purpose. The old company-wide cap answered 16 of 30 lunchtime
    // customers and silently ignored 14 — that did not separate a busy shop from
    // an abuser, it separated busy from small. 60/hour on ONE number still stops
    // a runaway AI-to-AI loop dead, which is the real reactive-path risk.
    reply: { minGapMs: 3_000, burst: 30, refillPerHour: 60, maxAttempts: 4, maxDeferralMs: 45 * 60_000, priority: 0 },
    // A shop pushing 40 orders through service in an hour used to emit ~120
    // completely ungoverned status messages. This is the budget that path never
    // had; 30/hour per number covers a real shop's order flow and still stops a
    // loop from becoming a flood.
    notification: { minGapMs: 20_000, burst: 10, refillPerHour: 30, maxAttempts: 4, maxDeferralMs: 6 * 60 * 60_000, priority: 1 },
    // Three back-to-back, then one every ten minutes, and never more than
    // COLD_DAILY_CAP distinct new recipients a day on one number. A human doing
    // first-contact outreach by hand does not exceed this; the 40-identical-
    // messages-in-a-minute burst the Follow-ups tab allowed cannot come close.
    cold: { minGapMs: 180_000, burst: 3, refillPerHour: 6, maxAttempts: 2, maxDeferralMs: 6 * 60 * 60_000, priority: 2 },
};
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
export const COLD_DAILY_CAP = Number(process.env.WHATSAPP_COLD_DAILY_CAP ?? 20) || 20;
const COLD_WINDOW_MS = 24 * 60 * 60_000;
/** Backlog per line. Past it the queue refuses rather than growing without bound. */
const MAX_QUEUE_PER_LINE = 200;
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
export const DERIVED_DEDUP_WINDOW_MS = 5 * 60_000;
/**
 * A caller-supplied key names a business event ("rfq_x to supplier_y",
 * "followup_44", "order_12:ready"), not a piece of text, so it is remembered
 * for a day. That is what makes "resend the RFQ" safe: the suppliers already
 * served collapse, and only the ones that were missed go.
 */
export const EXPLICIT_DEDUP_WINDOW_MS = 24 * 60 * 60_000;
/** A line that is not linked right now: wait, do not fail. Its messages are not lost. */
const LINE_DOWN_RETRY_MS = 60_000;
/** Transport backoff: 15s, 45s, 135s, … capped. Jittered so a batch does not retry in lockstep. */
const BACKOFF_BASE_MS = 15_000;
const BACKOFF_FACTOR = 3;
const BACKOFF_MAX_MS = 15 * 60_000;
/**
 * An error nobody has classified is retried at most twice, not four times.
 *
 * The bias is deliberate. An unrecognised error that is really permanent,
 * retried on a schedule, is precisely the loop that got numbers restricted; an
 * unrecognised error that is really transient costs one message and a row the
 * owner can see. A lost message is recoverable, a restricted number is not.
 */
const UNKNOWN_MAX_ATTEMPTS = 2;
/** After this many duplicate hits on one key, something upstream is looping. Say so. */
const DUPLICATE_LOOP_ALERT_AT = 5;
/**
 * On restore, nothing goes out for a moment and the buckets do not start full.
 *
 * A container that restarts holding 40 queued messages must not answer by
 * emptying its burst capacity into WhatsApp in the first second — that is the
 * exact shape being avoided everywhere else in this file.
 */
const RESTART_QUIET_MS = 15_000;
const RESTART_BURST_TOKENS = 2;
/**
 * Thrown by a transport that already knows the failure is permanent — a route
 * refusal (`destination_not_on_whatsapp`, `bad_destination`), a reachability
 * verdict — so the queue does not have to re-derive it from an error string.
 */
export class PermanentSendError extends Error {
    code;
    reasonAr;
    constructor(reasonAr, code = "bad_destination") {
        super(reasonAr);
        this.name = "PermanentSendError";
        this.code = code;
        this.reasonAr = reasonAr;
    }
}
/** Thrown when the company's message allowance is spent. Not a transport fault, never retried on a timer. */
export class QuotaSendError extends Error {
    reasonAr;
    constructor(reasonAr) {
        super(reasonAr);
        this.name = "QuotaSendError";
        this.reasonAr = reasonAr;
    }
}
export function memoryOutboxJournal(seed = []) {
    const box = {
        records: seed.map((r) => ({ ...r })),
        load() {
            return box.records.map((r) => ({ ...r }));
        },
        save(records) {
            box.records = records.map((r) => ({ ...r }));
        },
    };
    return box;
}
/** Blocks the thread. Only ever used for the millisecond-scale rename retry. */
function sleepSync(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
/**
 * rename(2) is atomic within a directory on ext4 and on NTFS alike, but on
 * Windows it is also the call that loses a race with whatever briefly holds the
 * file open — Defender, the search indexer, a backup agent — surfacing as
 * EPERM/EBUSY on a dev box. Those are transient by nature, so retry for a few
 * tens of milliseconds rather than failing the save.
 */
function renameWithRetry(from, to) {
    for (let attempt = 0;; attempt++) {
        try {
            fs.renameSync(from, to);
            return;
        }
        catch (err) {
            const code = err.code;
            const transient = code === "EPERM" || code === "EACCES" || code === "EBUSY";
            if (!transient || attempt >= 5)
                throw err;
            sleepSync(10 * (attempt + 1));
        }
    }
}
/**
 * A rename is only durable once the DIRECTORY ENTRY is flushed: on ext4 a host
 * power cut moments after an fsynced file was renamed into place can still come
 * back showing the old name. Windows has no directory handle to open this way
 * and throws here — ignored, since NTFS commits the metadata itself and the
 * self-hosted target is Linux.
 */
function fsyncDir(dir) {
    try {
        const fd = fs.openSync(dir, "r");
        try {
            fs.fsyncSync(fd);
        }
        finally {
            fs.closeSync(fd);
        }
    }
    catch {
        /* see above */
    }
}
/**
 * Flushes registered by file journals, run on process exit.
 *
 * A save that FAILED (a full disk, a volume that went read-only for a moment)
 * leaves records that exist only in memory. Exit is the last chance to get them
 * down, and it is synchronous, which is why the journal's save path is
 * synchronous too. Kept on globalThis because Next's dev server re-evaluates
 * this module and a second copy would register a second handler.
 */
const journalGlobal = globalThis;
function registerJournalExitFlush(flush) {
    const flushers = (journalGlobal.__platformWhatsappJournalFlushers ??= new Set());
    flushers.add(flush);
    if (journalGlobal.__platformWhatsappJournalExitInstalled)
        return;
    journalGlobal.__platformWhatsappJournalExitInstalled = true;
    // "exit" only, deliberately. local-session.ts already owns the SIGTERM/SIGINT
    // handler and calls process.exit(0) at the end of it, which runs this; adding
    // a second signal handler here would just make two modules argue about who
    // gets to end the process.
    process.on("exit", () => {
        for (const fn of flushers) {
            try {
                fn();
            }
            catch {
                /* nothing above us left to report to */
            }
        }
    });
}
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
export function fileOutboxJournal(filePath) {
    const dir = path.dirname(filePath);
    const tmpPrefix = `${filePath}.tmp-`;
    let writes = 0;
    let failures = 0;
    // The last records a save could not get to disk. Not a queue: each save
    // carries the complete pending set, so the newest one supersedes the rest.
    let unwritten = null;
    const parseRecords = (file) => {
        let raw;
        try {
            raw = fs.readFileSync(file, "utf-8");
        }
        catch {
            return null;
        }
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.records))
                return null;
            return parsed.records.map(sanitizeRecord).filter((r) => r !== null);
        }
        catch {
            return null;
        }
    };
    const mtimeOf = (file) => {
        try {
            return fs.statSync(file).mtimeMs;
        }
        catch {
            return 0;
        }
    };
    /** Temp files an earlier process died in the middle of, newest first. */
    const leftoverTmpFiles = () => {
        const prefix = path.basename(tmpPrefix);
        try {
            return fs
                .readdirSync(dir)
                .filter((name) => name.startsWith(prefix))
                .map((name) => path.join(dir, name))
                .sort((a, b) => mtimeOf(b) - mtimeOf(a));
        }
        catch {
            return [];
        }
    };
    const writeAtomically = (records) => {
        // Serialized before any file is touched, so a serializer throw cannot leave
        // the journal half-replaced.
        const payload = JSON.stringify({ version: 1, savedAt: Date.now(), records });
        fs.mkdirSync(dir, { recursive: true });
        // pid + counter rather than a fixed name: two Node processes pointed at one
        // data directory (a stray `npm run dev` beside the container) sharing a
        // temp name could interleave into a half-written file that then gets
        // renamed over the real journal — the torn write, back through the side
        // door.
        const tmpFile = `${tmpPrefix}${process.pid}-${++writes}`;
        try {
            const fd = fs.openSync(tmpFile, "w");
            try {
                fs.writeFileSync(fd, payload);
                fs.fsyncSync(fd);
            }
            finally {
                fs.closeSync(fd);
            }
            renameWithRetry(tmpFile, filePath);
            fsyncDir(dir);
        }
        catch (err) {
            try {
                fs.unlinkSync(tmpFile);
            }
            catch {
                /* already gone */
            }
            throw err;
        }
    };
    // NO ROTATED BACKUP HERE, unlike store-persistence.ts, and the difference is
    // deliberate rather than an omission. A .bak is the PREVIOUS generation, and
    // the previous generation of this file contains messages that have since been
    // sent and removed from the pending set. Restoring one would put a delivered
    // message back on the queue and send it a second time — the duplicate
    // delivery this entire module exists to prevent, and the same coin flip
    // restore() already refuses for a record left in `sending`. Losing a backlog
    // that was never delivered is the lesser failure, and it is reported.
    const flushUnwritten = () => {
        if (!unwritten)
            return;
        try {
            writeAtomically(unwritten);
            unwritten = null;
        }
        catch {
            // Exit is the last word. There is nowhere left to escalate to.
        }
    };
    registerJournalExitFlush(flushUnwritten);
    return {
        load() {
            const main = fs.existsSync(filePath) ? parseRecords(filePath) : null;
            if (main) {
                // The journal parses, so the last rename completed and any temp file
                // still lying around is strictly older debris from a kill.
                for (const tmp of leftoverTmpFiles()) {
                    try {
                        fs.unlinkSync(tmp);
                    }
                    catch {
                        /* held open, or already gone */
                    }
                }
                return main;
            }
            // A missing journal is the normal first boot and says nothing.
            //
            // A journal that exists but will not parse is a real event. The ONLY
            // thing safe to adopt in its place is a temp file NEWER than it: a temp
            // file that parses is by definition a complete write that was fsynced and
            // then killed before its rename landed, so it is the newest state that
            // ever existed — never a stale generation whose messages have since gone
            // out. Anything older is refused for the same reason there is no .bak.
            const damagedAt = mtimeOf(filePath);
            for (const candidate of leftoverTmpFiles()) {
                if (mtimeOf(candidate) < damagedAt)
                    continue;
                const parsed = parseRecords(candidate);
                if (!parsed)
                    continue;
                console.error(`[whatsapp-outbox] ${damagedAt ? "the journal is unreadable" : "the journal is missing"} — recovered ` +
                    `${parsed.length} queued message(s) from the interrupted write ${path.basename(candidate)}. Check the disk.`);
                return parsed;
            }
            if (damagedAt) {
                console.error(`[whatsapp-outbox] ${filePath} is unreadable and no newer complete write was found — any messages that were queued ` +
                    `before the restart are lost. They were never sent, so nothing was delivered twice; whoever queued them has to ask again.`);
            }
            return [];
        },
        save(records) {
            try {
                writeAtomically(records);
                unwritten = null;
                failures = 0;
            }
            catch (err) {
                // Copied, because the records keep mutating in memory and what gets
                // retried at exit has to be the state that failed, not a later one.
                unwritten = records.map((r) => ({ ...r }));
                failures += 1;
                if (failures === 1 || failures % 10 === 0) {
                    console.error(`[whatsapp-outbox] could not journal ${records.length} queued message(s) to ${filePath} ` +
                        `(${failures} consecutive failure(s)) — the queue is still running, but a restart right now would lose the backlog:`, err instanceof Error ? err.message : err);
                }
            }
        },
    };
}
/** A record read back off disk is untrusted input: anything malformed is skipped, never crashed on. */
function sanitizeRecord(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const r = raw;
    const str = (v) => (typeof v === "string" && v ? v : null);
    const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
    const id = str(r.id);
    const lineKey = str(r.lineKey);
    const to = str(r.to);
    const kind = str(r.kind);
    if (!id || !lineKey || !to || typeof r.text !== "string")
        return null;
    if (kind !== "reply" && kind !== "notification" && kind !== "cold")
        return null;
    const now = Date.now();
    return {
        id,
        lineKey,
        companyId: str(r.companyId) ?? "",
        installedEmployeeId: str(r.installedEmployeeId),
        to,
        text: r.text,
        kind,
        idempotencyKey: str(r.idempotencyKey) ?? id,
        idempotencyExplicit: r.idempotencyExplicit === true,
        status: str(r.status) ?? "queued",
        attempts: num(r.attempts, 0),
        enqueuedAt: num(r.enqueuedAt, now),
        dueAt: num(r.dueAt, now),
        expiresAt: num(r.expiresAt, now + OUTBOX_POLICY[kind].maxDeferralMs),
        lastAttemptAt: typeof r.lastAttemptAt === "number" ? r.lastAttemptAt : null,
        sentAt: typeof r.sentAt === "number" ? r.sentAt : null,
        providerMessageId: str(r.providerMessageId),
        failureCode: str(r.failureCode),
        failureReasonAr: str(r.failureReasonAr),
        lastErrorMessage: str(r.lastErrorMessage),
        duplicateHits: num(r.duplicateHits, 0),
        contextLabelAr: str(r.contextLabelAr),
        counterpartName: str(r.counterpartName),
    };
}
// --- pure helpers ----------------------------------------------------------
/** Digits, or a JID left intact — an inbound @c.us/@lid address is not a phone number. */
export function normalizeAddress(to) {
    const trimmed = (to ?? "").trim();
    if (trimmed.includes("@"))
        return trimmed.toLowerCase();
    return trimmed.replace(/\D/g, "");
}
function normalizeText(text) {
    return (text ?? "").trim().replace(/\s+/g, " ");
}
/** FNV-1a. Not a security hash — it only has to make two different messages differ. */
export function hashText(text) {
    let h = 0x811c9dc5;
    const s = normalizeText(text);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `${h.toString(36)}${s.length.toString(36)}`;
}
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
export function derivedIdempotencyKey(lineKey, to, text) {
    return `d:${lineKey}:${normalizeAddress(to)}:${hashText(text)}`;
}
export function backoffDelayMs(attempt, random = Math.random) {
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * Math.pow(BACKOFF_FACTOR, Math.max(0, attempt - 1)));
    // ±20%, so a batch that failed together does not come back in lockstep.
    // Ordinary retry jitter, the same reason every queue has it — not camouflage.
    return Math.round(base * (0.8 + random() * 0.4));
}
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
export function classifySendFailure(err) {
    if (err instanceof PermanentSendError)
        return { kind: "permanent", code: err.code, reasonAr: err.reasonAr };
    if (err instanceof QuotaSendError)
        return { kind: "quota", code: "quota_exhausted", reasonAr: err.reasonAr };
    const message = err instanceof Error ? err.message : String(err ?? "");
    if (/no lid for user|not a valid|not-authorized|not registered|invalid.*jid|jid.*invalid|no account|wid error/i.test(message)) {
        return {
            kind: "permanent",
            code: "no_whatsapp_account",
            reasonAr: "الرقم ما عليه حساب واتساب (غالباً خط أرضي أو رقم خدمة) — ما رح نحاول معه مرة ثانية.",
        };
    }
    if (/malformed|invalid phone|invalid number|bad request|رقم غير صالح/i.test(message)) {
        return { kind: "permanent", code: "bad_destination", reasonAr: "الرقم غير صالح — صحّحه من ملف جهة الاتصال." };
    }
    if (/blocked|has blocked you|recipient blocked/i.test(message)) {
        return { kind: "permanent", code: "blocked_by_recipient", reasonAr: "المستلم حظر هذا الرقم — ما رح نحاول معه مرة ثانية." };
    }
    if (/quota|الحصة|رصيد الرسائل/i.test(message)) {
        return { kind: "quota", code: "quota_exhausted", reasonAr: "انتهت حصة الرسائل الشهرية — جدّد الباقة ليُستأنف الإرسال." };
    }
    if (/غير متصل|not connected|disconnect|logged out|unpaired|no session|session closed|target closed|protocol error|execution context/i.test(message)) {
        return { kind: "line_down", code: "line_not_linked", reasonAr: "رقم واتساب غير متصل حالياً — الرسالة بانتظار عودة الاتصال." };
    }
    if (/timeout|etimedout|econnreset|econnrefused|socket hang up|eai_again|enotfound|network|fetch failed|\b(429|500|502|503|504)\b|too many requests|rate limit|evaluation failed/i.test(message)) {
        const limited = /\b429\b|too many requests|rate limit/i.test(message);
        return {
            kind: "transient",
            code: limited ? "rate_limited_upstream" : "transport_unavailable",
            reasonAr: limited
                ? "واتساب رفض الإرسال مؤقتاً بسبب الضغط — رح نعيد المحاولة بعد فترة."
                : "تعذّر الإرسال مؤقتاً — رح نعيد المحاولة بعد فترة.",
        };
    }
    return { kind: "transient", code: "unknown", reasonAr: `تعذّر الإرسال (${message.slice(0, 120)}) — محاولة أخيرة وبعدها يتوقف.` };
}
/**
 * Every queue built in this process.
 *
 * There is one in production, but the shutdown path must not have to be told
 * where it is: manager.ts builds the queue lazily, so a hook that had to fetch
 * it would construct one during shutdown just to shut it down.
 */
const liveOutboxes = new Set();
/**
 * Quiesces every live queue. Called from the process's shutdown path — see
 * WhatsAppOutbox.shutdown for what the drain is actually buying.
 */
export async function shutdownWhatsAppOutboxes(drainMs = 2_000) {
    await Promise.all([...liveOutboxes].map((outbox) => outbox.shutdown(drainMs)));
}
export class WhatsAppOutbox {
    deps;
    lines = new Map();
    byId = new Map();
    dedup = new Map();
    /** Records that fell off a line's recent list while their idempotency key was still live. */
    orphaned = new Set();
    seq = 0;
    observer = null;
    /** Set by shutdown(): the process is going down and must start nothing new. */
    stopping = false;
    constructor(deps) {
        this.deps = deps;
        this.observer = deps.onChange ?? null;
        liveOutboxes.add(this);
    }
    /** Attached after construction so restore()'s notifications reach it too. */
    setObserver(fn) {
        this.observer = fn;
    }
    // --- accepting ----------------------------------------------------------
    /**
     * Takes a message and returns immediately. Nothing here waits on pacing, on
     * a browser, or on WhatsApp — that is the whole point: a caller that blocks
     * on send pacing is a caller that eventually times out and retries, which is
     * how the duplicates were being manufactured.
     */
    enqueue(req) {
        const now = this.deps.now();
        this.pruneDedup(now);
        const to = normalizeAddress(req.to);
        const explicit = (req.idempotencyKey ?? "").trim();
        const key = explicit ? `k:${req.lineKey}:${explicit}` : derivedIdempotencyKey(req.lineKey, to, req.text);
        const seen = this.dedup.get(key);
        if (seen) {
            seen.hits += 1;
            const original = this.byId.get(seen.id);
            if (original) {
                original.duplicateHits += 1;
                if (original.duplicateHits === DUPLICATE_LOOP_ALERT_AT) {
                    this.warn(`[whatsapp-outbox] ${original.duplicateHits} duplicate attempts of the same message to ${original.to} on line ${original.lineKey} — something upstream is retrying in a loop (message ${original.id}, «${(original.contextLabelAr ?? "").slice(0, 40)}»). The duplicates collapse, but the loop itself is the bug.`);
                }
                this.emit(original);
                return {
                    id: original.id,
                    status: original.status,
                    duplicate: true,
                    estimatedSendAt: original.dueAt,
                    reasonAr: original.failureReasonAr,
                };
            }
            // The record aged out of memory but its key is still inside the window,
            // so this is still a duplicate — reported honestly as "already handled"
            // rather than sent again.
            return { id: seen.id, status: "sent", duplicate: true, estimatedSendAt: seen.at, reasonAr: null };
        }
        const line = this.lineFor(req.lineKey, now);
        // So the estimate handed back is against the budget as it stands now, and
        // so a line that has been quiet for an hour is not told it has to wait.
        this.refill(line, now);
        const record = {
            id: this.nextId(now),
            lineKey: req.lineKey,
            companyId: req.companyId,
            installedEmployeeId: req.installedEmployeeId ?? null,
            to,
            text: req.text,
            kind: req.kind,
            idempotencyKey: key,
            idempotencyExplicit: Boolean(explicit),
            status: "queued",
            attempts: 0,
            enqueuedAt: now,
            dueAt: now,
            expiresAt: now + OUTBOX_POLICY[req.kind].maxDeferralMs,
            lastAttemptAt: null,
            sentAt: null,
            providerMessageId: null,
            failureCode: null,
            failureReasonAr: null,
            lastErrorMessage: null,
            duplicateHits: 0,
            contextLabelAr: req.contextLabelAr ?? null,
            counterpartName: req.counterpartName ?? null,
        };
        // Refusals happen here, before the key is remembered: a message that was
        // never accepted must not suppress the caller's next attempt.
        const refusal = this.refuseUpFront(line, record, now);
        if (refusal) {
            record.status = "dropped";
            record.failureCode = refusal.code;
            record.failureReasonAr = refusal.reasonAr;
            this.byId.set(record.id, record);
            this.remember(line, record);
            this.emit(record);
            this.warn(`[whatsapp-outbox] refused a ${record.kind} message to ${record.to} on line ${record.lineKey}: ${refusal.code} — ${refusal.reasonAr}`);
            return { id: record.id, status: "dropped", duplicate: false, estimatedSendAt: now, reasonAr: refusal.reasonAr };
        }
        this.byId.set(record.id, record);
        this.dedup.set(key, {
            id: record.id,
            at: now,
            expiresAt: now + (explicit ? EXPLICIT_DEDUP_WINDOW_MS : DERIVED_DEDUP_WINDOW_MS),
            hits: 0,
        });
        line.queue.push(record);
        this.emit(record);
        this.persist();
        return { id: record.id, status: "queued", duplicate: false, estimatedSendAt: this.estimateSendAt(line, record, now), reasonAr: null };
    }
    refuseUpFront(line, record, now) {
        if (!record.to)
            return { code: "bad_destination", reasonAr: "ما في رقم مستلم — الرسالة ما انبعثت." };
        if (line.queue.length >= MAX_QUEUE_PER_LINE) {
            return {
                code: "queue_full",
                reasonAr: `طابور الإرسال على هذا الرقم ممتلئ (${MAX_QUEUE_PER_LINE} رسالة بانتظار الإرسال) — الرسالة ما انضافت. في شي عم يرسل بشكل غير طبيعي، راجع سجل الموظف.`,
            };
        }
        if (record.kind !== "cold")
            return null;
        // The hard cap, counted over recipients this line has actually opened a
        // cold conversation with, plus the ones already waiting to be opened.
        const pending = new Set(line.queue.filter((r) => r.kind === "cold").map((r) => r.to));
        const sent = new Set(line.coldRecipients.filter((c) => now - c.at < COLD_WINDOW_MS).map((c) => c.to));
        if (sent.has(record.to) || pending.has(record.to))
            return null;
        if (sent.size + pending.size >= COLD_DAILY_CAP) {
            return {
                code: "cold_daily_cap",
                reasonAr: `هذا الرقم وصل الحد اليومي لمراسلة أرقام جديدة (${COLD_DAILY_CAP} رقم خلال ٢٤ ساعة). الحد موجود ليحمي رقمك من التقييد — أرسل لباقي الأرقام بكرة، أو من رقم ثاني.`,
            };
        }
        return null;
    }
    // --- pumping ------------------------------------------------------------
    /**
     * One pass: every line gets a look, and each line may hand at most one
     * message to the transport.
     *
     * Lines are pumped in parallel and hold their own state, which is what makes
     * them isolated: a line saturated with cold outreach delays only itself, and
     * a second line's reply still goes out on time. Under the old company-keyed
     * budgets that was exactly backwards.
     */
    async tick() {
        // Nothing new is handed to a transport that is about to disappear with the
        // process. See shutdown().
        if (this.stopping)
            return;
        const now = this.deps.now();
        this.pruneDedup(now);
        await Promise.all([...this.lines.values()].map((line) => this.pumpLine(line, now)));
    }
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
    async shutdown(drainMs = 2_000) {
        this.stopping = true;
        const busyLines = () => [...this.lines.values()].filter((line) => line.busy).length;
        const started = busyLines();
        const deadline = Date.now() + Math.max(0, drainMs);
        while (busyLines() > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const stillSending = busyLines();
        // Belt and braces: every settle already persisted, but a save that failed
        // earlier gets one more attempt here while there is still a process to
        // report it from.
        this.persist();
        if (started) {
            this.warn(`[whatsapp-outbox] shutting down: ${started - stillSending} send(s) finished on the way out, ${stillSending} still in flight ` +
                `(those are journalled as sending and will be reported to the owner rather than resent).`);
        }
        return { drained: started - stillSending, stillSending };
    }
    /** Test seam, and the dev-server case where a module is re-evaluated rather than restarted. */
    resume() {
        this.stopping = false;
    }
    async pumpLine(line, now) {
        this.expireOverdue(line, now);
        if (line.busy)
            return;
        const waiting = line.queue.filter((r) => (r.status === "queued" || r.status === "failed_retrying") && r.dueAt <= now);
        if (!waiting.length)
            return;
        if (now < line.nextFreeAt)
            return;
        if (this.deps.transport.lineReady && !this.deps.transport.lineReady(line.key)) {
            // Not a failure and not an attempt: the message waits for the number to
            // come back. Hammering a disconnected session is pointless, and on the
            // local transport it is also how browsers get stacked on one profile.
            for (const record of waiting) {
                record.dueAt = now + LINE_DOWN_RETRY_MS;
                record.failureCode = "line_not_linked";
                record.failureReasonAr = "رقم واتساب غير متصل حالياً — الرسالة محفوظة وبتنبعث أول ما يرجع الاتصال.";
                this.emit(record);
            }
            this.persist();
            return;
        }
        this.refill(line, now);
        waiting.sort((a, b) => OUTBOX_POLICY[a.kind].priority - OUTBOX_POLICY[b.kind].priority || a.dueAt - b.dueAt || a.enqueuedAt - b.enqueuedAt);
        // A reply is chosen ahead of queued outreach; and when the cold bucket is
        // empty, the reply behind it is not held hostage by it.
        const job = waiting.find((r) => line.tokens[r.kind] >= 1);
        if (!job)
            return;
        line.tokens[job.kind] -= 1;
        line.busy = true;
        job.status = "sending";
        job.lastAttemptAt = now;
        this.emit(job);
        this.persist();
        try {
            const result = await this.deps.transport.send(job);
            this.settleSent(line, job, (result && result.providerMessageId) || null);
        }
        catch (err) {
            this.settleFailure(line, job, err);
        }
        finally {
            line.busy = false;
        }
    }
    settleSent(line, job, providerMessageId) {
        const now = this.deps.now();
        job.status = "sent";
        job.sentAt = now;
        job.providerMessageId = providerMessageId;
        job.failureCode = null;
        job.failureReasonAr = null;
        job.attempts += 1;
        // Measured from when this send FINISHED, so the gap is real spacing
        // between two messages leaving the number rather than between two
        // decisions to send one.
        line.nextFreeAt = now + OUTBOX_POLICY[job.kind].minGapMs;
        if (job.kind === "cold")
            line.coldRecipients.push({ to: job.to, at: now });
        this.remove(line, job);
        this.remember(line, job);
        this.emit(job);
        this.persist();
    }
    settleFailure(line, job, err) {
        const now = this.deps.now();
        const verdict = classifySendFailure(err);
        job.lastErrorMessage = (err instanceof Error ? err.message : String(err ?? "")).slice(0, 300);
        job.failureCode = verdict.code;
        job.failureReasonAr = verdict.reasonAr;
        if (verdict.kind === "line_down") {
            // The transport answered "I am not connected" — same treatment as
            // lineReady saying so: wait, do not burn an attempt, do not fail.
            job.status = "queued";
            job.dueAt = now + LINE_DOWN_RETRY_MS;
            this.emit(job);
            this.persist();
            return;
        }
        job.attempts += 1;
        line.nextFreeAt = now + OUTBOX_POLICY[job.kind].minGapMs;
        if (verdict.kind === "permanent") {
            job.status = "failed_permanent";
            this.remove(line, job);
            this.remember(line, job);
            this.emit(job);
            this.persist();
            // Loud on purpose. This is the class of failure that, retried, got
            // numbers restricted; it has to be visible the first time it happens.
            this.warn(`[whatsapp-outbox] PERMANENT failure sending to ${job.to} on line ${job.lineKey} (${verdict.code}): ${job.lastErrorMessage}. Not retrying — this destination will not be attempted again for this message.`);
            return;
        }
        if (verdict.kind === "quota") {
            job.status = "dropped";
            this.remove(line, job);
            this.remember(line, job);
            this.emit(job);
            this.persist();
            return;
        }
        const cap = verdict.code === "unknown" ? UNKNOWN_MAX_ATTEMPTS : OUTBOX_POLICY[job.kind].maxAttempts;
        if (job.attempts >= cap) {
            job.status = "failed_permanent";
            job.failureCode = "gave_up";
            job.failureReasonAr = `فشل الإرسال ${job.attempts} مرات ووقفنا المحاولة (${verdict.reasonAr}) — أرسلها يدوياً إذا كانت مهمة.`;
            this.remove(line, job);
            this.remember(line, job);
            this.emit(job);
            this.persist();
            this.warn(`[whatsapp-outbox] giving up on ${job.id} to ${job.to} on line ${job.lineKey} after ${job.attempts} attempts: ${job.lastErrorMessage}`);
            return;
        }
        job.status = "failed_retrying";
        job.dueAt = now + backoffDelayMs(job.attempts, this.deps.random ?? Math.random);
        this.emit(job);
        this.persist();
    }
    expireOverdue(line, now) {
        const stale = line.queue.filter((r) => r.status !== "sending" && now >= r.expiresAt);
        if (!stale.length)
            return;
        for (const record of stale) {
            record.status = "dropped";
            record.failureCode = "expired";
            record.failureReasonAr =
                record.kind === "reply"
                    ? "الرد انتظر بالطابور أكثر من اللازم وما عاد مناسب يوصل متأخر — الرسالة محفوظة بالمحادثة وفيك ترد يدوياً."
                    : "الرسالة انتظرت بالطابور أكثر من المهلة وما انبعثت — أعد إرسالها إذا لسا مطلوبة.";
            this.remove(line, record);
            this.remember(line, record);
            this.emit(record);
        }
        this.persist();
    }
    // --- restart ------------------------------------------------------------
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
    restore() {
        const journal = this.deps.journal;
        if (!journal)
            return { requeued: 0, droppedInFlight: 0, expired: 0 };
        const now = this.deps.now();
        let requeued = 0;
        let droppedInFlight = 0;
        let expired = 0;
        for (const record of journal.load()) {
            const line = this.lineFor(record.lineKey, now);
            this.byId.set(record.id, record);
            // Rebuilt so a webhook redelivered across the restart still collapses.
            const window = record.idempotencyExplicit ? EXPLICIT_DEDUP_WINDOW_MS : DERIVED_DEDUP_WINDOW_MS;
            if (now - record.enqueuedAt < window) {
                this.dedup.set(record.idempotencyKey, { id: record.id, at: record.enqueuedAt, expiresAt: record.enqueuedAt + window, hits: 0 });
            }
            if (record.status === "sending") {
                record.status = "dropped";
                record.failureCode = "restart_in_flight";
                record.failureReasonAr =
                    "انقطع الخادم أثناء إرسال هذه الرسالة وما منعرف إذا وصلت أو لأ — فما أعدنا إرسالها حتى ما توصل مرتين. راجعها وأرسلها يدوياً إذا لزم.";
                this.remember(line, record);
                this.emit(record);
                droppedInFlight++;
                continue;
            }
            if (now >= record.expiresAt) {
                record.status = "dropped";
                record.failureCode = "expired";
                record.failureReasonAr = "كانت بانتظار الإرسال قبل إعادة تشغيل الخادم وانتهت مهلتها — أعد إرسالها إذا لسا مطلوبة.";
                this.remember(line, record);
                this.emit(record);
                expired++;
                continue;
            }
            record.status = record.attempts > 0 ? "failed_retrying" : "queued";
            record.dueAt = Math.max(record.dueAt, now + RESTART_QUIET_MS);
            line.queue.push(record);
            line.tokens = {
                reply: Math.min(OUTBOX_POLICY.reply.burst, RESTART_BURST_TOKENS),
                notification: Math.min(OUTBOX_POLICY.notification.burst, RESTART_BURST_TOKENS),
                cold: Math.min(OUTBOX_POLICY.cold.burst, RESTART_BURST_TOKENS),
            };
            line.lastRefillAt = now;
            this.emit(record);
            requeued++;
        }
        this.persist();
        if (requeued || droppedInFlight || expired) {
            this.warn(`[whatsapp-outbox] restored after restart: ${requeued} message(s) requeued, ${droppedInFlight} dropped because they were mid-send when the process died (not resent — a duplicate is worse), ${expired} expired while down.`);
        }
        return { requeued, droppedInFlight, expired };
    }
    // --- reporting ----------------------------------------------------------
    get(id) {
        return this.byId.get(id) ?? null;
    }
    /** Every state a message can be in, for the employee's messages tab. */
    listForEmployee(installedEmployeeId, limit = 50) {
        const rows = [];
        for (const record of this.byId.values())
            if (record.installedEmployeeId === installedEmployeeId)
                rows.push(record);
        return rows.sort((a, b) => b.enqueuedAt - a.enqueuedAt).slice(0, limit);
    }
    snapshot(lineKey) {
        const now = this.deps.now();
        const line = this.lines.get(lineKey);
        const queue = line?.queue ?? [];
        const queued = queue.filter((r) => r.status === "queued").length;
        const sending = queue.filter((r) => r.status === "sending").length;
        const retrying = queue.filter((r) => r.status === "failed_retrying").length;
        const oldest = queue.reduce((min, r) => Math.min(min, r.enqueuedAt), now);
        const nextDue = queue
            .filter((r) => r.status !== "sending")
            .reduce((min, r) => (min === null ? r.dueAt : Math.min(min, r.dueAt)), null);
        const coldSent = new Set((line?.coldRecipients ?? []).filter((c) => now - c.at < COLD_WINDOW_MS).map((c) => c.to)).size;
        const waiting = queued + sending + retrying;
        return {
            lineKey,
            queued,
            sending,
            retrying,
            oldestWaitMs: waiting ? now - oldest : 0,
            nextDueAt: waiting ? nextDue : null,
            coldSentLast24h: coldSent,
            coldRemainingToday: Math.max(0, COLD_DAILY_CAP - coldSent),
            noteAr: waiting ? `${waiting} رسالة بانتظار الإرسال من هذا الرقم — بتنبعث على مهل حمايةً للرقم من التقييد.` : null,
        };
    }
    /** Non-terminal depth across every line — for the admin panel. */
    depth() {
        let n = 0;
        for (const line of this.lines.values())
            n += line.queue.length;
        return n;
    }
    lineKeys() {
        return [...this.lines.keys()];
    }
    // --- internals ----------------------------------------------------------
    lineFor(lineKey, now) {
        let line = this.lines.get(lineKey);
        if (!line) {
            line = {
                key: lineKey,
                queue: [],
                tokens: { reply: OUTBOX_POLICY.reply.burst, notification: OUTBOX_POLICY.notification.burst, cold: OUTBOX_POLICY.cold.burst },
                lastRefillAt: now,
                nextFreeAt: 0,
                busy: false,
                coldRecipients: [],
                recent: [],
            };
            this.lines.set(lineKey, line);
        }
        return line;
    }
    refill(line, now) {
        const elapsed = Math.max(0, now - line.lastRefillAt);
        if (!elapsed)
            return;
        for (const kind of ["reply", "notification", "cold"]) {
            const policy = OUTBOX_POLICY[kind];
            line.tokens[kind] = Math.min(policy.burst, line.tokens[kind] + (elapsed / 3_600_000) * policy.refillPerHour);
        }
        line.lastRefillAt = now;
        line.coldRecipients = line.coldRecipients.filter((c) => now - c.at < COLD_WINDOW_MS);
    }
    estimateSendAt(line, record, now) {
        const policy = OUTBOX_POLICY[record.kind];
        const ahead = line.queue.filter((r) => r !== record && OUTBOX_POLICY[r.kind].priority <= policy.priority).length;
        const shortfall = Math.max(0, ahead + 1 - line.tokens[record.kind]);
        const waitForTokens = shortfall > 0 ? (shortfall / policy.refillPerHour) * 3_600_000 : 0;
        return Math.max(now, line.nextFreeAt, now + waitForTokens, now + ahead * policy.minGapMs);
    }
    remove(line, record) {
        const index = line.queue.indexOf(record);
        if (index >= 0)
            line.queue.splice(index, 1);
    }
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
    remember(line, record) {
        line.recent.unshift(record);
        if (line.recent.length > 100) {
            for (const evicted of line.recent.splice(100)) {
                if (this.dedup.has(evicted.idempotencyKey))
                    this.orphaned.add(evicted.id);
                else
                    this.byId.delete(evicted.id);
            }
        }
    }
    pruneDedup(now) {
        for (const [key, entry] of this.dedup) {
            if (now < entry.expiresAt)
                continue;
            this.dedup.delete(key);
            if (this.orphaned.delete(entry.id))
                this.byId.delete(entry.id);
        }
    }
    persist() {
        const journal = this.deps.journal;
        if (!journal)
            return;
        const pending = [];
        for (const line of this.lines.values())
            for (const record of line.queue)
                pending.push(record);
        journal.save(pending);
    }
    emit(record) {
        try {
            this.observer?.(record);
        }
        catch (err) {
            // An observer that throws (a message-log write, say) must not take the
            // queue down with it — the message still has to go out.
            this.warn(`[whatsapp-outbox] observer threw for ${record.id}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    warn(line) {
        if (this.deps.log)
            this.deps.log(line);
        else
            console.error(line);
    }
    nextId(now) {
        this.seq += 1;
        return `wob_${now.toString(36)}_${this.seq.toString(36)}`;
    }
}
/**
 * How a queue state reads in the per-employee message log, whose vocabulary
 * predates this queue ("queued" | "sent" | "delivered" | "failed" | "refused").
 *
 * A message still being retried reads as `queued`, not `failed`: it has not
 * stopped, and a row that says "failed" while the queue is still trying is a
 * row that makes the owner send it again by hand — which is a duplicate.
 */
export function outboxStatusToDelivery(status) {
    switch (status) {
        case "sent":
            return "sent";
        case "failed_permanent":
            return "failed";
        case "dropped":
            return "refused";
        default:
            return "queued";
    }
}
/** Whether this row needs the owner's eyes before anything else moves. */
export function outboxNeedsAttention(record) {
    return record.status === "failed_permanent" || record.status === "dropped";
}
//# sourceMappingURL=outbox.js.map