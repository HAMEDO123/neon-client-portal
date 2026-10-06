import { prisma } from "@/lib/db";
import { dispatchNotification } from "@/lib/notifications/engine";
import { managerEmployeeId } from "@/lib/manager-account";
import { getSetting, setSetting } from "@/lib/settings";
import { activeTransport } from "@/lib/whatsapp";
import { whatsAppChats } from "@/lib/whatsapp/worker";
import {
  arrivalCopy,
  arrivalKey,
  inboxUrl,
  look,
  readInboxSummary,
  readWatchState,
  type InboxSummary,
} from "@/lib/whatsapp-watch";

// Telling the team that somebody wrote to the studio's WhatsApp.
//
// Every minute the chat list is asked for, compared with what had already been
// announced (lib/whatsapp-watch.ts decides what is new), and each new arrival
// is told once to everybody who can open the inbox — the team and the manager.
// The studio asked for exactly that: a client's message is something everyone
// hears about, not only whoever happens to have the tab open.
//
// It asks rather than being told. The worker has no way of calling the site
// when a message lands, and the worker is the one service here that must not
// be restarted lightly — it holds the linked session. Asking once a minute
// through the read it already serves needed no change to it at all.
//
// **Nothing here marks anything read**, on the handset or anywhere else, and
// it never sends. It reads the list and speaks to the team.

export const WATCH_STATE_KEY = "whatsapp_watch";
export const INBOX_SUMMARY_KEY = "whatsapp_inbox_summary";

/** How many chats one look covers: the most recently active, which is where news is. */
const LOOK_AT = 60;

export type WhatsAppPass =
  | { skipped: string }
  | { chats: number; arrivals: number; told: number; first: boolean };

export async function runWhatsAppWatch(now: Date = new Date()): Promise<WhatsAppPass> {
  // Only the worker has an inbox to read; Meta's Cloud API sends and nothing more.
  if (activeTransport() !== "worker") return { skipped: "no linked WhatsApp number to read" };

  const result = await whatsAppChats(LOOK_AT);
  // Unlinked, restarting, unreachable: nothing is known, so nothing is said
  // and nothing is forgotten. The next look picks up from the same place.
  if (!result.ok) return { skipped: result.error };

  const state = readWatchState(await getSetting(WATCH_STATE_KEY));
  const { arrivals, next, summary } = look(result.data.chats, state, now.getTime());

  // Written before anybody is told: a pass that dies half-way through telling
  // must not start again from the top a minute later. The keys on the
  // notifications make a repeat harmless; this makes it not happen.
  await setSetting(WATCH_STATE_KEY, JSON.stringify(next));
  await setSetting(INBOX_SUMMARY_KEY, JSON.stringify(summary));

  if (arrivals.length === 0) {
    return { chats: result.data.chats.length, arrivals: 0, told: 0, first: state === null };
  }

  // Everybody who can open it — telling somebody about a message they are not
  // allowed to read would be a notification that opens onto a refusal.
  const team = await prisma.employee.findMany({
    where: { active: true, accessRole: "EMPLOYEE", canReadWhatsApp: true },
    select: { id: true },
  });
  const manager = await managerEmployeeId();

  const people: { id: string; side: "admin" | "employee" }[] = [
    ...team.map((person) => ({ id: person.id, side: "employee" as const })),
    // The manager's own row, where there is one: a link into the admin, never
    // into the employee portal, which would turn them away.
    ...(manager ? [{ id: manager, side: "admin" as const }] : []),
  ];

  let told = 0;
  // One at a time, like every other pass here.
  for (const arrival of arrivals) {
    const copy = arrivalCopy(arrival);
    for (const person of people) {
      const sent = await dispatchNotification({
        employeeId: person.id,
        type: "WHATSAPP_MESSAGE",
        title: copy.title,
        message: copy.message,
        url: inboxUrl(person.side, arrival.chatId),
        dedupeKey: arrivalKey(arrival, person.id),
      }).catch(() => null);
      if (sent?.created) told++;
    }
  }

  return { chats: result.data.chats.length, arrivals: arrivals.length, told, first: false };
}

/**
 * The company number's conversations as the chat list draws them — a row per
 * client — read from what the last look stored, never by asking the worker:
 * the chat list must not wait on a browser in another container to draw itself.
 * So a row is at most a minute behind, and a look that could not read the
 * number leaves the rows it had rather than an empty list.
 *
 * Null when there is no linked number, so nothing of WhatsApp's is drawn for a
 * studio that has none.
 */
export async function inboxSummary(): Promise<InboxSummary | null> {
  if (activeTransport() !== "worker") return null;
  return (
    readInboxSummary(await getSetting(INBOX_SUMMARY_KEY)) ?? {
      // Linked, and not looked at yet: there are no rows to show so far.
      checkedAt: 0,
      unreadChats: 0,
      latest: null,
      rows: [],
    }
  );
}
