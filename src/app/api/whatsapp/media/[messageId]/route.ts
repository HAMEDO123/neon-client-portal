import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { attachmentResponse, readAttachment } from "@/lib/whatsapp-attachments";

// One message's attachment, as bytes.
//
// Served rather than handed over as base64 so a photo can be the src of an
// <img>, a voice note the src of an <audio>, and a document the href of a link
// — the page never carries a megabyte of text per picture.
//
// What is handed over is decided in lib/whatsapp-attachments.ts, shared with
// the phone app's route: a voice note comes out as AAC, which an iPhone plays,
// and a `Range` request is answered with the part asked for, without which
// Safari will not play audio or video at all.
//
// Never cached by the browser: these are somebody's private messages, and the
// guard has to run every time one is asked for. It runs first, here, before
// anything is looked up.

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ messageId: string }> }) {
  try {
    await requireWhatsAppAccess();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messageId } = await context.params;
  const result = await readAttachment(messageId);
  if (!result.ok) return new Response(result.error, { status: result.status ?? 502 });

  return attachmentResponse(request, result.data);
}
