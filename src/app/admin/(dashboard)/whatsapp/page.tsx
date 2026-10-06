import { redirect } from "next/navigation";
import { getTimezone } from "@/lib/settings";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { whatsAppChats } from "@/lib/whatsapp/worker";
import { whatsAppChatUrl } from "@/lib/whatsapp-watch";
import { WhatsAppInbox } from "@/components/whatsapp/whatsapp-inbox";

// The company number's WhatsApp, in the dashboard.
//
// The studio runs on one WhatsApp number, and reading it used to mean holding
// the phone. This is that number's conversations, for the manager and whoever
// the manager has trusted with it.
//
// No heading and no description: the shell gives this page the whole window
// (`fillsWindow` in lib/full-window.ts), and a title above a messaging app is
// a line of chrome that costs a line of conversation on every screen. What the
// page is, is the tab it was opened from.
//
// The first load is server-side so the page arrives with the chats already on
// it; everything after that the component refreshes for itself.

export const dynamic = "force-dynamic";

export default async function AdminWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string | string[] }>;
}) {
  try {
    await requireWhatsAppAccess();
  } catch {
    redirect("/admin");
  }

  // A notification about one chat opens that chat — in the chat section, where
  // the clients' conversations live beside the team's. The notification keeps
  // this address because the phone app reads these paths too.
  const { chat } = await searchParams;
  if (typeof chat === "string" && chat) redirect(whatsAppChatUrl("admin", chat));

  const timezone = await getTimezone();
  const result = await whatsAppChats();

  return (
    <WhatsAppInbox
      initialChats={result.ok ? result.data.chats : []}
      initialError={result.ok ? null : result.error}
      timeZone={timezone}
    />
  );
}
