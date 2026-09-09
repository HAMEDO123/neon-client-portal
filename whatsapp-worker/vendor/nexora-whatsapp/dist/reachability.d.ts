export type Reachability = "on_whatsapp" | "not_on_whatsapp" | "unknown";
/**
 * What the transport must be able to answer for this module to work.
 *
 * An interface rather than a direct import so the policy below can be tested
 * with a fake, and so the Cloud API — which genuinely cannot answer — can say
 * so by returning null instead of pretending.
 */
export type ReachabilityProbe = (lineKey: string, phone: string) => Promise<boolean | null>;
export declare function digitsOf(phone: string): string;
export declare function isJid(phone: string): boolean;
/**
 * Numbers that cannot be a mobile WhatsApp account, decided without asking.
 *
 * Kept narrow on purpose. Every entry here is a number the platform would
 * otherwise burn a lookup on and then fail to send to, and a false positive
 * costs a real message — so only shapes that cannot be a personal mobile are
 * listed, not merely unusual ones.
 */
export declare function obviouslyUnsendable(phone: string): string | null;
export type ReachabilityResult = {
    reachable: true;
    from: "cache" | "probe" | "assumed";
} | {
    reachable: false;
    reasonAr: string;
    permanent: true;
};
/**
 * The gate every outbound WhatsApp send passes through.
 *
 * `assumed` is not a weaker `true` — it is the honest answer when nobody could
 * be asked, and it lets the send proceed. The alternative, refusing whenever we
 * cannot check, would silently stop every Cloud API company from messaging
 * anyone.
 */
export declare function checkReachable(input: {
    lineKey: string;
    phone: string;
    probe: ReachabilityProbe;
    /**
     * True when this is a reply to somebody who just messaged us. They are
     * demonstrably on WhatsApp, so asking is a wasted round trip — and a lookup
     * that fails must never block a reply a customer is waiting for.
     */
    isReply?: boolean;
    now?: number;
}): Promise<ReachabilityResult>;
/**
 * Records a send failure the transport reported, so the next attempt does not
 * repeat it.
 *
 * whatsapp-web.js reports an absent account as "No LID for user" from deep
 * inside its own internals — a sentence written for whoever wrote the library.
 * Recognising it here is what turns a permanent failure into a remembered one
 * instead of a retry every fifteen minutes.
 */
export declare function recordSendFailure(lineKey: string, phone: string, error: unknown, now?: number): {
    permanent: boolean;
};
/** Test seam. Never called in production. */
export declare function resetReachabilityCache(): void;
/** What the dashboard shows when it explains why a message is not going out. */
export declare function knownUnreachableCount(): number;
//# sourceMappingURL=reachability.d.ts.map