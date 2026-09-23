import { redirect } from "next/navigation";
import { getTimezone } from "@/lib/settings";
import { requireWhatsAppReader } from "@/lib/admin-guard";
import { whatsAppChats } from "@/lib/whatsapp/worker";
import { WhatsAppInbox } from "@/components/whatsapp/whatsapp-inbox";

// The same WhatsApp tab, for the people the manager has trusted with it.
//
// One component and one guard, mounted twice, rather than a second inbox: the
// two portals must not be able to disagree about who may read the studio's
// messages. Somebody without the permission is sent home rather than shown an
// empty tab, because an empty tab reads as "no messages".

export const dynamic = "force-dynamic";

export default async function EmployeeWhatsAppPage() {
  try {
    await requireWhatsAppReader();
  } catch {
    redirect("/employee");
  }

  const timezone = await getTimezone();
  const result = await whatsAppChats();

  return (
    <div className="p-4 lg:p-6">
      <h1 className="text-xl font-semibold text-ink lg:text-2xl">WhatsApp</h1>
      <p className="mt-1 text-sm text-ink/50">
        The studio&rsquo;s own number. Reading only &mdash; nothing here sends a message, and opening a chat does not
        mark it read on the phone.
      </p>

      <div className="mt-4">
        <WhatsAppInbox
          initialChats={result.ok ? result.data.chats : []}
          initialError={result.ok ? null : result.error}
          timeZone={timezone}
        />
      </div>
    </div>
  );
}
