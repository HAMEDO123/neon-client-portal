import { redirect } from "next/navigation";
import { requireChatViewer } from "@/lib/chat";
import { getSessionEmployee } from "@/lib/employee-session";
import { inboxSummary } from "@/lib/notifications/whatsapp-events";
import { getTimezone } from "@/lib/settings";
import { chatFromRow, chatIdFromSegment } from "@/lib/whatsapp-watch";
import { WhatsAppThread } from "@/components/whatsapp/whatsapp-inbox";

// One client's WhatsApp conversation, as a screen of the employee's chat.
//
// The company number's chats are rows in the chat list (see
// components/chat/conversation-list.tsx), and this is where one opens: its own
// screen, like a conversation with a colleague — the portal's header and tab
// bar give way to it (`.chat-screen`), and the arrow leads back to the list.
// The manager's side is `/admin/chat/wa/[chatId]`, which says why this is the
// WhatsApp tab's own thread rather than a ChatRoom.
//
// The permission is the WhatsApp one, read fresh and read off the employee's
// own row: somebody the manager has switched it off for is sent back to their
// chats rather than shown a conversation that would refuse to load. (Not
// `requireWhatsAppAccess`, which a manager's session in the same browser would
// satisfy on their behalf — the list page asks the same way, so the two agree.)
// Opening it marks nothing read on the handset.
//
// `fills-frame` has to be on the element this returns — the selector behind it
// matches a direct child of the portal's main column.

export const dynamic = "force-dynamic";

export default async function EmployeeWhatsAppConversationPage({ params }: { params: Promise<{ chatId: string }> }) {
  const viewer = await requireChatViewer("EMPLOYEE");
  if (viewer.type !== "EMPLOYEE") throw new Error("Unauthorized");

  const me = await getSessionEmployee();
  if (!me?.canReadWhatsApp) redirect("/employee/chat");

  const chatId = chatIdFromSegment((await params).chatId);
  const summary = await inboxSummary();
  const timezone = await getTimezone();

  return (
    <div className="chat-screen fills-frame flex flex-col overflow-hidden">
      <WhatsAppThread
        key={chatId}
        chat={chatFromRow(chatId, summary?.rows.find((row) => row.id === chatId))}
        timeZone={timezone}
        backHref="/employee/chat"
      />
    </div>
  );
}
