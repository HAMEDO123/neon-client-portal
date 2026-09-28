import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { mobileViewer } from "@/lib/mobile-auth";
import { json } from "@/lib/mobile/rpc";
import { workerStatus } from "@/lib/mobile/whatsapp-inbox";
import { whatsAppMessageMedia } from "@/lib/whatsapp/worker";

// One WhatsApp message's attachment, as bytes, for the phone app.
//
// The same read as the website's /api/whatsapp/media/[messageId] — fetched only
// when somebody opens it, never cached beyond this request — behind the same
// guard, which accepts the app's bearer token. A route of its own rather than a
// registry read because an attachment is a file, not JSON: a photo is shown as
// it arrives and a document is handed to the system viewer.
//
// Two differences, both for the phone:
//   - **Not allowed is 403, not 401.** A 401 signs the app out; somebody whose
//     WhatsApp permission was taken away is still signed in to everything else.
//   - **A name the header cannot carry is still sent.** An Arabic file name in a
//     plain `filename="…"` is not a valid header value, so it goes as RFC 5987
//     `filename*` with an ASCII stand-in beside it.

export const dynamic = "force-dynamic";

function disposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `inline; filename="${ascii || "attachment"}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export async function GET(request: Request, context: { params: Promise<{ messageId: string }> }) {
  if (!(await mobileViewer(request))) return json({ error: "Unauthorized." }, 401);

  try {
    await requireWhatsAppAccess();
  } catch {
    return json({ error: "That is not available to you." }, 403);
  }

  const { messageId } = await context.params;
  if (!messageId) return json({ error: "messageId is required." }, 400);

  const result = await whatsAppMessageMedia(messageId);
  if (!result.ok) return json({ error: result.error }, workerStatus(result.status));

  const bytes = Buffer.from(result.data.base64, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": result.data.mimeType || "application/octet-stream",
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      ...(result.data.filename ? { "content-disposition": disposition(result.data.filename) } : {}),
    },
  });
}
