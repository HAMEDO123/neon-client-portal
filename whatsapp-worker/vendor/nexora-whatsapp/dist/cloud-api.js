// Real, official WhatsApp Business Cloud API (Meta Graph API) — the legal
// replacement for the whatsapp-web.js Connector path (an unofficial
// automation of the consumer WhatsApp Web client, which is what got a real
// account banned). This talks to graph.facebook.com directly over HTTPS
// with a real access token; no browser automation anywhere in this file.
import crypto from "crypto";
const GRAPH_API_VERSION = "v23.0";
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
function graphErrorMessage(body) {
    if (body && typeof body === "object" && "error" in body) {
        const err = body.error;
        if (err?.message)
            return err.message;
    }
    return "Unknown Graph API error";
}
// Real credential check — calls Meta's own API and only reports success if
// Meta actually confirms the phone number ID and token are valid together.
// Never assumes success just because values were typed in.
export async function verifyWhatsAppCloudCredentials(creds) {
    try {
        const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}?fields=display_phone_number,verified_name`, {
            headers: { Authorization: `Bearer ${creds.accessToken}` },
        });
        const body = await res.json();
        if (!res.ok)
            return { ok: false, error: graphErrorMessage(body) };
        return { ok: true, displayPhoneNumber: body.display_phone_number ?? "", verifiedName: body.verified_name ?? "" };
    }
    catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : "تعذر الوصول لـ Meta Graph API" };
    }
}
// Real send — a genuine WhatsApp message goes out over Meta's own API.
// Throws (callers already handle send failures the same way the Connector
// path does) rather than silently swallowing a failed send.
export async function sendWhatsAppCloudMessage(creds, to, text) {
    const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`WhatsApp Cloud API send failed: ${graphErrorMessage(body)}`);
    }
}
// Real Meta Cloud API feature: marks the given inbound message as read and
// shows an actual "typing…" indicator in the customer's chat for up to 25
// seconds (or until a real message is sent, whichever comes first) — the
// official-API equivalent of the Connector's whatsapp-web.js
// sendStateTyping() presence call, scoped to a specific message instead of
// a chat since that's what Meta's API requires. Cosmetic only — a failure
// here should never block or fail the real reply that follows it, so this
// warns instead of throwing.
export async function sendWhatsAppCloudTypingIndicator(creds, messageId) {
    try {
        const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`, {
            method: "POST",
            headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
            body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: messageId, typing_indicator: { type: "text" } }),
        });
        if (!res.ok) {
            const body = await res.json().catch(() => null);
            console.warn(`[whatsapp-cloud] typing indicator failed (sending reply anyway): ${graphErrorMessage(body)}`);
        }
    }
    catch (err) {
        console.warn(`[whatsapp-cloud] typing indicator request failed (sending reply anyway):`, err instanceof Error ? err.message : err);
    }
}
// Real two-step download (Meta requires it): first resolve the media ID to
// a short-lived authenticated URL, then fetch the actual bytes from that
// URL with the same bearer token. Used for a real inbound WhatsApp voice
// note before it's handed to ElevenLabs for transcription.
export async function downloadWhatsAppMedia(creds, mediaId) {
    const metaRes = await fetch(`${GRAPH_API_BASE}/${mediaId}`, { headers: { Authorization: `Bearer ${creds.accessToken}` } });
    if (!metaRes.ok)
        throw new Error(`WhatsApp media lookup failed: ${graphErrorMessage(await metaRes.json().catch(() => null))}`);
    const meta = (await metaRes.json());
    if (!meta.url)
        throw new Error("WhatsApp media lookup returned no URL");
    const fileRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${creds.accessToken}` } });
    if (!fileRes.ok)
        throw new Error(`WhatsApp media download failed (${fileRes.status})`);
    return { buffer: Buffer.from(await fileRes.arrayBuffer()), mimeType: meta.mime_type ?? "audio/ogg" };
}
// Uploads real bytes to Meta's media store and returns the media ID needed
// to reference it in a real "send" call — shared by both the voice-reply
// path (fixed filename) and the media-asset send path below (the real
// uploaded file's own name).
async function uploadWhatsAppMedia(creds, buffer, mimeType, filename) {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("file", new Blob([new Uint8Array(buffer)], { type: mimeType }), filename);
    const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}/media`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}` },
        body: form,
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.id)
        throw new Error(`WhatsApp media upload failed: ${graphErrorMessage(body)}`);
    return body.id;
}
// Real voice message send — uploads the real synthesized audio, then sends
// a genuine WhatsApp "audio" message referencing it (a proper voice-note
// bubble on the customer's end, not a file attachment).
export async function sendWhatsAppCloudVoiceMessage(creds, to, audio, mimeType = "audio/ogg; codecs=opus") {
    // Meta's upload wants the bare type; the "; codecs=opus" suffix the local
    // transport uses is not accepted there. Ogg/Opus is what renders as a voice
    // note on the customer's phone; MP3 renders as an audio file.
    const bare = mimeType.split(";")[0].trim();
    const mediaId = await uploadWhatsAppMedia(creds, audio, bare, bare === "audio/ogg" ? "voice-reply.ogg" : "voice-reply.mp3");
    const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", to, type: "audio", audio: { id: mediaId } }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`WhatsApp Cloud API voice send failed: ${graphErrorMessage(body)}`);
    }
}
// Real image/document send from the company's own media library (see
// MediaAsset) — fetches the actual file bytes from its real R2-backed URL,
// uploads them to Meta the same way the voice path does, then sends a
// genuine "image" or "document" message referencing them. PDFs and
// anything not a directly-displayable image go as a document (with the
// real filename attached) rather than forced into an image bubble.
export async function sendWhatsAppCloudMediaMessage(creds, to, fileUrl, mimeType, filename) {
    const fileRes = await fetch(fileUrl);
    if (!fileRes.ok)
        throw new Error(`Couldn't fetch the media file to send (${fileRes.status})`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const mediaId = await uploadWhatsAppMedia(creds, buffer, mimeType, filename);
    const isImage = mimeType.startsWith("image/");
    const res = await fetch(`${GRAPH_API_BASE}/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${creds.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
            messaging_product: "whatsapp",
            to,
            type: isImage ? "image" : "document",
            ...(isImage ? { image: { id: mediaId } } : { document: { id: mediaId, filename } }),
        }),
    });
    if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(`WhatsApp Cloud API media send failed: ${graphErrorMessage(body)}`);
    }
}
// Confirms a webhook payload genuinely came from Meta (HMAC-SHA256 of the
// raw request body, keyed with the app secret) before it's trusted enough
// to feed into the real AI auto-reply pipeline — without this, anyone who
// finds the webhook URL could POST fake "incoming messages" and trigger
// real Claude calls (cost) and fake conversation records.
export function verifyWebhookSignature(rawBody, signatureHeader, appSecret) {
    if (!signatureHeader)
        return false;
    const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length)
        return false;
    return crypto.timingSafeEqual(a, b);
}
//# sourceMappingURL=cloud-api.js.map