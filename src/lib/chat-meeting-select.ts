// What a meeting card is read as, wherever it is read: inside a message, from
// the live stream, and on the Meetings list. One shape, so a card drawn from
// any of them is the same card.
//
// A module of its own, with no imports, because both chat.ts (a message
// carries its card) and chat-meeting-store.ts (which writes messages) need it —
// the same reason chat-task-select.ts stands alone.

export const chatMeetingSelect = {
  id: true,
  messageId: true,
  title: true,
  agenda: true,
  mode: true,
  place: true,
  startsAt: true,
  durationMinutes: true,
  remindMinutes: true,
  createdAt: true,
  attendees: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      memberKey: true,
      name: true,
      color: true,
      rsvp: true,
      // Which version of the answer a screen last saw, so a reply shown ahead
      // of the server is dropped the moment the row changes for any reason.
      updatedAt: true,
    },
  },
} as const;
