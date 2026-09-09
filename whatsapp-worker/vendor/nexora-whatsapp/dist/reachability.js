// Whether a number can receive WhatsApp at all — asked once, remembered, and
// never asked again for a number that has already said no.
//
// This is the single most expensive mistake this platform has made with a
// customer's linked number. The travel employee scraped hotel contacts off
// booking pages, got switchboard landlines (an Istanbul 212 number, a US
// toll-free 800), and a sweep retried them every fifteen minutes for weeks.
// The container log filled with:
//
//     [travel-sweep] failed for negotiation hneg_rve58ruy: No LID for user
//
// From WhatsApp's side that is one account repeatedly trying to open
// conversations with numbers that have no account. It is one of the clearest
// abuse signatures there is, it is exactly what gets a linked number
// restricted, and the platform did it continuously while the dashboard showed
// a negotiation in progress.
//
// The fix has three parts and all three matter:
//
//   1. ASK BEFORE SENDING, at the transport, not at each caller. There are 29
//      send call sites; a rule enforced at 29 places is a rule enforced at 28
//      places by next month.
//   2. REMEMBER A NO. A number without a WhatsApp account will not grow one
//      because we asked again. Re-asking is itself the signal.
//   3. NEVER TREAT "I COULD NOT ASK" AS A NO. The Cloud API offers no such
//      lookup, and a linked session that is down cannot answer either. An
//      unanswerable question must not block a legitimate message — that would
//      break every Cloud API company on the platform.
//
// Deliberately NOT here: anything that disguises the lookup or the client. The
// point is to stop emitting the behaviour, not to hide it.
/**
 * A "no" is remembered far longer than a "yes".
 *
 * A number that has no WhatsApp account is a fact about the number, not about
 * today, and the whole point is to stop re-asking. A "yes" is cached only long
 * enough to spare a repeat lookup inside one conversation — an account can be
 * deleted, and continuing to believe a stale yes just moves the failure later.
 */
const NEGATIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const POSITIVE_TTL_MS = 12 * 60 * 60 * 1000;
/** After this many failed lookups the answer is treated as settled, not retried. */
const MAX_PROBE_ATTEMPTS = 3;
const cache = new Map();
const keyFor = (lineKey, phone) => `${lineKey}::${digitsOf(phone)}`;
export function digitsOf(phone) {
    const trimmed = phone.trim();
    // An inbound message can carry a full JID, including WhatsApp's @lid privacy
    // address, which is not a phone number at all. Replying to one of those is
    // always legitimate — the person just messaged us — so it is recognised here
    // and never sent to a lookup that would fail on it.
    if (trimmed.includes("@"))
        return trimmed;
    return trimmed.replace(/\D/g, "");
}
export function isJid(phone) {
    return phone.trim().includes("@");
}
/**
 * Numbers that cannot be a mobile WhatsApp account, decided without asking.
 *
 * Kept narrow on purpose. Every entry here is a number the platform would
 * otherwise burn a lookup on and then fail to send to, and a false positive
 * costs a real message — so only shapes that cannot be a personal mobile are
 * listed, not merely unusual ones.
 */
export function obviouslyUnsendable(phone) {
    if (isJid(phone))
        return null;
    const digits = digitsOf(phone);
    if (!digits)
        return "لا يوجد رقم.";
    // Shorter than a country code plus a subscriber number.
    if (digits.length < 8)
        return `الرقم «${phone}» قصير جداً ليكون رقم واتساب.`;
    if (digits.length > 15)
        return `الرقم «${phone}» أطول من أي رقم دولي صالح.`;
    // Toll-free and premium ranges are switchboards by definition — a hotel's
    // published 800 number reaches a call centre, never a WhatsApp account.
    if (/^1?8(00|33|44|55|66|77|88)/.test(digits))
        return `الرقم «${phone}» رقم مجاني (خدمة عملاء) ولا يستقبل واتساب.`;
    if (/^(\d)\1+$/.test(digits))
        return `الرقم «${phone}» أرقام مكرّرة — غالباً ليس رقماً حقيقياً.`;
    return null;
}
/**
 * The gate every outbound WhatsApp send passes through.
 *
 * `assumed` is not a weaker `true` — it is the honest answer when nobody could
 * be asked, and it lets the send proceed. The alternative, refusing whenever we
 * cannot check, would silently stop every Cloud API company from messaging
 * anyone.
 */
export async function checkReachable(input) {
    const now = input.now ?? Date.now();
    if (input.isReply || isJid(input.phone))
        return { reachable: true, from: "assumed" };
    const shape = obviouslyUnsendable(input.phone);
    if (shape)
        return { reachable: false, reasonAr: shape, permanent: true };
    const key = keyFor(input.lineKey, input.phone);
    const cached = cache.get(key);
    if (cached) {
        const ttl = cached.value === "not_on_whatsapp" ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS;
        if (cached.value !== "unknown" && now - cached.at < ttl) {
            if (cached.value === "not_on_whatsapp")
                return { reachable: false, reasonAr: notOnWhatsAppAr(input.phone), permanent: true };
            return { reachable: true, from: "cache" };
        }
        // Repeated failures to get an answer settle as "stop asking". Left as
        // reachable so a legitimate message still goes, but the lookup stops
        // costing a round trip on every send.
        if (cached.value === "unknown" && cached.asked >= MAX_PROBE_ATTEMPTS) {
            return { reachable: true, from: "assumed" };
        }
    }
    let answer;
    try {
        answer = await input.probe(input.lineKey, digitsOf(input.phone));
    }
    catch {
        answer = null;
    }
    if (answer === null) {
        cache.set(key, { value: "unknown", at: now, asked: (cached?.asked ?? 0) + 1 });
        return { reachable: true, from: "assumed" };
    }
    cache.set(key, { value: answer ? "on_whatsapp" : "not_on_whatsapp", at: now, asked: 0 });
    return answer ? { reachable: true, from: "probe" } : { reachable: false, reasonAr: notOnWhatsAppAr(input.phone), permanent: true };
}
const notOnWhatsAppAr = (phone) => `الرقم ${phone} ما عليه حساب واتساب (غالباً خط أرضي أو رقم خدمة) — جرّب البريد الإلكتروني أو رقم موبايل.`;
/**
 * Records a send failure the transport reported, so the next attempt does not
 * repeat it.
 *
 * whatsapp-web.js reports an absent account as "No LID for user" from deep
 * inside its own internals — a sentence written for whoever wrote the library.
 * Recognising it here is what turns a permanent failure into a remembered one
 * instead of a retry every fifteen minutes.
 */
export function recordSendFailure(lineKey, phone, error, now = Date.now()) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    const permanent = /no lid for user|not a valid|not-authorized|jid.*invalid|invalid.*jid|not registered/i.test(message);
    if (permanent && !isJid(phone)) {
        cache.set(keyFor(lineKey, phone), { value: "not_on_whatsapp", at: now, asked: 0 });
    }
    return { permanent };
}
/** Test seam. Never called in production. */
export function resetReachabilityCache() {
    cache.clear();
}
/** What the dashboard shows when it explains why a message is not going out. */
export function knownUnreachableCount() {
    let n = 0;
    for (const v of cache.values())
        if (v.value === "not_on_whatsapp")
            n++;
    return n;
}
//# sourceMappingURL=reachability.js.map