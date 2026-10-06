import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { mobileViewer } from "@/lib/mobile-auth";
import { json } from "@/lib/mobile/rpc";
import { workerStatus } from "@/lib/mobile/whatsapp-inbox";
import { attachmentResponse, readAttachment } from "@/lib/whatsapp-attachments";

// One WhatsApp message's attachment, as bytes, for the phone app.
//
// The same read as the website's /api/whatsapp/media/[messageId] — fetched only
// when somebody opens it — behind the same guard, which accepts the app's
// bearer token. A route of its own rather than a registry read because an
// attachment is a file, not JSON: a photo is shown as it arrives and a document
// is handed to the system viewer.
//
// What is handed over is decided once for both routes, in
// lib/whatsapp-attachments.ts, and two parts of it are for the phone above all:
//   - **A voice note arrives as AAC in an .m4a.** WhatsApp's own Ogg Opus is
//     not something an iPhone plays.
//   - **Every file has a name with an extension** ("photo.jpg",
//     "voice-note.m4a"), in a header that can carry Arabic. The app saves what
//     it downloads under that name and hands it to the system, which decides
//     what a file is by its extension — "attachment" opens in nothing.
//
// **Not allowed is 403, not 401.** A 401 signs the app out; somebody whose
// WhatsApp permission was taken away is still signed in to everything else.

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ messageId: string }> }) {
  if (!(await mobileViewer(request))) return json({ error: "Unauthorized." }, 401);

  try {
    await requireWhatsAppAccess();
  } catch {
    return json({ error: "That is not available to you." }, 403);
  }

  const { messageId } = await context.params;
  if (!messageId) return json({ error: "messageId is required." }, 400);

  const result = await readAttachment(messageId);
  if (!result.ok) return json({ error: result.error }, workerStatus(result.status));

  return attachmentResponse(request, result.data);
}
