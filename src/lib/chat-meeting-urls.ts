import {
  conversationFromKey,
  conversationSlug,
  employeeChatUrl,
  type ChatViewer,
} from "@/lib/chat-conversations";

// Where a notification about a meeting opens it, on each side.
//
// Pulled out of the meeting actions so the mobile API can reach them without
// importing a "use server" module. A notification addressed to the manager
// must never carry an `/employee` link — that portal refuses them, and a
// notification opening a page that turns you away reads as a broken platform.

/** On an employee's phone. */
export function employeeMeetingUrl(channelKey: string, meetingId: string, employeeId: string) {
  const conversation = conversationFromKey(channelKey);
  return conversation ? `${employeeChatUrl(conversation, employeeId)}?meeting=${meetingId}` : "/employee/chat";
}

/** The same, for the manager. */
export function adminMeetingUrl(channelKey: string, meetingId: string) {
  const conversation = conversationFromKey(channelKey);
  const manager: ChatViewer = { type: "ADMIN", id: null, name: "Manager" };
  return conversation ? `/admin/chat/${conversationSlug(conversation, manager)}?meeting=${meetingId}` : "/admin/chat";
}
