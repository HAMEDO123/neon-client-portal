// What a task card is read as, wherever it is read: inside a message, from the
// live stream, and on the Tasks list. One shape, so a card drawn from any of
// them is the same card.
//
// A module of its own, with no imports, because both chat.ts (a message
// carries its card) and chat-task-store.ts (which writes messages) need it.

export const chatTaskSelect = {
  id: true,
  messageId: true,
  title: true,
  description: true,
  dueAt: true,
  priority: true,
  attachmentUrl: true,
  attachmentName: true,
  attachmentType: true,
  createdAt: true,
  assignments: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      employeeId: true,
      state: true,
      // Which version of the part a screen last saw, so a status shown ahead of
      // the server is dropped the moment the part changes for any reason.
      updatedAt: true,
      employee: { select: { name: true, color: true } },
      // The photo waiting for the manager, if there is one: what the review is of.
      submissions: {
        where: { status: "PENDING" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { id: true, imageUrl: true, note: true, createdAt: true },
      },
    },
  },
  // The newest, so a long thread still opens on what was said last.
  comments: {
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, authorType: true, authorId: true, authorName: true, body: true, createdAt: true },
  },
  _count: { select: { comments: true } },
} as const;
