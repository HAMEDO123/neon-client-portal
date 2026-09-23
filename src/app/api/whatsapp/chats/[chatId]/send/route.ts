import { NextResponse } from "next/server";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { sameOrigin } from "@/lib/request-origin";
import { sendWhatsAppChatMessage, whatsAppChatMessages } from "@/lib/whatsapp/worker";

// Answering a client from the portal, as the studio's own number.
//
// The conversation is read before anything is sent, and it settles three
// things at once that must not be taken from the browser:
//
//   - **that the chat exists**, so an id somebody typed cannot address a
//     stranger,
//   - **whether it is a group**, which the library refuses to post into and
//     which is refused here with a sentence rather than an Arabic exception
//     from four layers down,
//   - **what kind of message this is** — the library's whole safety model.
//     A conversation the other person has written in is a reply and uncapped;
//     one where only we have is a notification. A browser must not get to
//     choose that, which is why it is decided here from what the account
//     itself holds.
//
// `sameOrigin` because a route handler has no origin check of its own, and
// this one can send as the studio.

export const dynamic = "force-dynamic";

const MAX_LENGTH = 4000;

export async function POST(request: Request, context: { params: Promise<{ chatId: string }> }) {
  try {
    await requireWhatsAppAccess();
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!sameOrigin(request)) return NextResponse.json({ error: "Bad origin." }, { status: 403 });

  const { chatId } = await context.params;
  const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) return NextResponse.json({ error: "Write something first." }, { status: 400 });
  if (text.length > MAX_LENGTH) {
    return NextResponse.json({ error: `That is longer than ${MAX_LENGTH} characters.` }, { status: 400 });
  }

  const conversation = await whatsAppChatMessages(chatId, 30);
  if (!conversation.ok) {
    return NextResponse.json({ error: conversation.error }, { status: conversation.status ?? 502 });
  }
  if (conversation.data.chat.isGroup) {
    return NextResponse.json(
      { error: "Messages cannot be sent into a WhatsApp group from here — send it to a person instead." },
      { status: 400 }
    );
  }

  const theyHaveWritten = conversation.data.messages.some((message) => !message.fromMe);
  const sent = await sendWhatsAppChatMessage(chatId, text, theyHaveWritten ? "reply" : "notification");
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status ?? 502 });

  // Queued, not gone: the queue paces what leaves the number, and the message
  // appears in the thread when the next read finds it in WhatsApp's own store.
  return NextResponse.json({ queued: true });
}
