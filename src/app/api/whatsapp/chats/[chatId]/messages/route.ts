import { NextResponse } from "next/server";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { whatsAppChatMessages } from "@/lib/whatsapp/worker";

// One conversation, oldest message first.
//
// Nothing here marks anything read: the worker deliberately never calls
// sendSeen for a read, so opening a chat in the portal leaves the phone's own
// unread badges exactly as they were.

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ chatId: string }> }) {
  try {
    await requireWhatsAppAccess();
  } catch {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { chatId } = await context.params;
  const limit = Number(new URL(request.url).searchParams.get("limit")) || 50;

  const result = await whatsAppChatMessages(chatId, limit);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status ?? 502 });

  return NextResponse.json(result.data);
}
