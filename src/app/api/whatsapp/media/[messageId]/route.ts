import { requireWhatsAppReader } from "@/lib/admin-guard";
import { whatsAppMessageMedia } from "@/lib/whatsapp/worker";

// One message's attachment, as bytes.
//
// Served rather than handed over as base64 so a photo can be the src of an
// <img> and a document can be the href of a link — the browser then streams
// and caches it like any other file, instead of the page carrying a megabyte
// of text per picture.
//
// Never cached beyond this request: these are somebody's private messages, and
// the guard has to run every time one is asked for.

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ messageId: string }> }) {
  try {
    await requireWhatsAppReader();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }

  const { messageId } = await context.params;
  const result = await whatsAppMessageMedia(messageId);
  if (!result.ok) return new Response(result.error, { status: result.status ?? 502 });

  const bytes = Buffer.from(result.data.base64, "base64");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "content-type": result.data.mimeType,
      "content-length": String(bytes.byteLength),
      "cache-control": "private, no-store",
      ...(result.data.filename
        ? { "content-disposition": `inline; filename="${result.data.filename.replace(/"/g, "")}"` }
        : {}),
    },
  });
}
