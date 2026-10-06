import { redirect } from "next/navigation";
import { getTimezone } from "@/lib/settings";
import { requireWhatsAppAccess } from "@/lib/admin-guard";
import { whatsAppChats } from "@/lib/whatsapp/worker";
import { whatsAppChatUrl } from "@/lib/whatsapp-watch";
import { WhatsAppInbox } from "@/components/whatsapp/whatsapp-inbox";

// The same WhatsApp tab, for the people the manager has trusted with it.
//
// One component and one guard, mounted twice, rather than a second inbox: the
// two portals must not be able to disagree about who may read the studio's
// messages, or answer in them. Somebody without the permission is sent home
// rather than shown an empty tab, because an empty tab reads as "no messages".
//
// `fills-frame` is what takes the portal's padding and scrolling off this page
// so it can manage both itself — and the class has to be on the element this
// returns, because the selector behind it (`.employee-main:has(> .fills-frame)`
// in globals.css) matches a **direct** child. Wrapping this in a div would
// quietly give the page back its scrollbar.

export const dynamic = "force-dynamic";

export default async function EmployeeWhatsAppPage({
  searchParams,
}: {
  searchParams: Promise<{ chat?: string | string[] }>;
}) {
  try {
    await requireWhatsAppAccess();
  } catch {
    redirect("/employee");
  }

  // A notification about one chat opens that chat — in the chat section, where
  // the clients' conversations live beside the team's.
  const { chat } = await searchParams;
  if (typeof chat === "string" && chat) redirect(whatsAppChatUrl("employee", chat));

  const timezone = await getTimezone();
  const result = await whatsAppChats();

  return (
    <div className="fills-frame">
      <WhatsAppInbox
        initialChats={result.ok ? result.data.chats : []}
        initialError={result.ok ? null : result.error}
        timeZone={timezone}
      />
    </div>
  );
}
