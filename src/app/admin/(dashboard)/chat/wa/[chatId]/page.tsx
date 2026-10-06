import { redirect } from "next/navigation";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { conversationsFor, requireChatViewer } from "@/lib/chat";
import { inboxSummary } from "@/lib/notifications/whatsapp-events";
import { getTimezone } from "@/lib/settings";
import { chatFromRow, chatIdFromSegment, whatsAppChatBase } from "@/lib/whatsapp-watch";
import { ConversationPanel } from "@/components/chat/studio/conversation-panel";
import { WhatsAppThread } from "@/components/whatsapp/whatsapp-inbox";

// One client's WhatsApp conversation, inside the chat section.
//
// The studio asked for the company number's chats to be in the same chat the
// team uses, a row each — so opening one is opening a conversation here, with
// the same list beside it, rather than leaving for the WhatsApp tab. The
// address is `/admin/chat/wa/<the chat's own id>`; `wa` is a segment of its
// own so it can never be mistaken for an employee's id, which is what the
// segment after `/chat/` otherwise is.
//
// **Not a ChatRoom.** A team conversation streams from this platform's own
// messages; this one is a window onto the account the worker holds, read when
// it is asked for and answered through the queue. It is the WhatsApp tab's own
// thread (`WhatsAppThread`), mounted here — one component, so the two places
// cannot come to read or answer differently — and it has no tasks, meetings or
// calls, because the person at the other end is not on this platform.
//
// Opening it marks nothing read on the handset.

export const dynamic = "force-dynamic";

export default async function AdminWhatsAppConversationPage({ params }: { params: Promise<{ chatId: string }> }) {
  try {
    await requireWhatsAppAccess();
  } catch {
    redirect("/admin/chat");
  }
  const viewer = await requireChatViewer("ADMIN");

  const chatId = chatIdFromSegment((await params).chatId);

  // One after the other, like the other multi-query pages here.
  const summary = await inboxSummary();
  const rows = summary?.rows ?? [];
  const conversations = await conversationsFor(viewer);
  const timezone = await getTimezone();
  const now = new Date();

  return (
    <div className="chat-screen flex h-full gap-4 bg-paper lg:p-5">
      <aside className="hidden w-[18rem] shrink-0 overflow-hidden rounded-3xl border border-warm-line bg-card shadow-[0_18px_40px_-30px_rgba(44,39,34,0.5)] lg:flex xl:w-[19rem]">
        <ConversationPanel
          items={conversations}
          basePath="/admin/chat"
          timeZone={timezone}
          initialNow={now.getTime()}
          tasksHref="/admin/chat?view=tasks"
          whatsapp={{ basePath: whatsAppChatBase("admin"), rows, activeId: chatId }}
        />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden border-warm-line bg-card lg:rounded-3xl lg:border lg:shadow-[0_18px_40px_-30px_rgba(44,39,34,0.5)]">
        {/* Keyed by the chat: moving from one client to another must start a
            fresh thread, not show the last one's messages under a new name. */}
        <WhatsAppThread
          key={chatId}
          chat={chatFromRow(chatId, rows.find((row) => row.id === chatId))}
          timeZone={timezone}
          backHref="/admin/chat"
        />
      </div>
    </div>
  );
}
