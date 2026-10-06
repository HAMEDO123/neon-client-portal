# The company WhatsApp, at the top of the chats (server side is done)

Hand this to Claude on the Mac. The server half is live on
`https://clients.neonjo.com`.

## What the studio asked for

> The company WhatsApp we linked should show its messages to everybody. Put it
> in the Chat section, pinned at the top for every member of the team. Any
> message on the company WhatsApp gives everybody a notification. Any employee
> can see the messages that reach the company, and reply.

## What is already true, with no app change

- **Everybody on the team has it.** `canReadWhatsApp` is on by default and was
  switched on for the whole team (2026-10-06). `/me` already carries it, so the
  WhatsApp tile under More now appears for every employee. The manager can still
  untick one person on their page — keep reading the flag, do not assume it.
- **Everybody is told.** A new `NotificationType`, `WHATSAPP_MESSAGE`, is sent
  to every person who may open the inbox (the team, and the manager's own row)
  within a minute of a client writing. Title `WhatsApp · <who>`, body their
  words (or "Photo", "Voice note" …), one per chat per minute.
  - Its link is `/employee/whatsapp?chat=<chatId>` for the team and
    `/admin/whatsapp?chat=<chatId>` for the manager. **Today `PushRoute` sends
    both to the More tab**, because neither path is one it knows.
  - `NotificationsView` switches on the type string with a default, so the new
    type already lists safely; it has no icon of its own yet.

## The app's half

1. **A pinned first row in `ChatListView`**, above every conversation and above
   the pinned ones, for anybody with `canReadWhatsApp` (the manager always):
   a green WhatsApp mark, the title "WhatsApp", a small pin, the newest message
   as its second line, and a badge. Tapping it pushes `WhatsAppRootView()`.
   It is **not** a `ConversationSummary` — it has no slug, cannot be unpinned,
   muted or swiped, and must not go through `openChat`.

   Its data is one read, which answers at once (it never asks the worker):

       GET /api/mobile/get/whatsapp/summary

       { "checkedAt": 1791280800000,
         "unreadChats": 4,
         "latest": { "title": "Abu Mohammad", "preview": "مرحبا…",
                     "at": 1791280740000, "fromMe": false } }

   `null` means there is no linked number: draw no row. `latest` is null before
   the first look. `unreadChats` is chats with something unread on the handset,
   not messages. Second line: `"<title>: <preview>"`, prefixed "You → " when
   `fromMe`. Refresh it when the list refreshes and on `.neonDataChanged`.

2. **Notification taps.** In `PushRoute`, a path beginning `/employee/whatsapp`
   or `/admin/whatsapp` should land on the Chat tab and open `WhatsAppRootView`
   — on the chat named by `?chat=` when there is one (the id is URL-encoded and
   contains `@`). `ChatListView.openFromNotification` is where the chat tab
   already reads a pending path.

3. **`NotificationsView`**: an icon and colour for `WHATSAPP_MESSAGE` (and for
   `SITE_VISIT`, which has had none since it was added).

## Do not

- Do not mark anything read. Opening a chat from the app must not clear the
  unread badge on the handset — the worker never calls `sendSeen`, and that is
  on purpose.
- Do not build a second inbox inside the chat list (a row per client). The
  inbox has its own list, search and replies; this is one door into it.
- Do not post into groups: the server refuses, with a sentence. Show it.

Server files: `src/lib/whatsapp-watch.ts` (what counts as a new message, pure
and tested), `src/lib/notifications/whatsapp-events.ts` (the minute's look and
the summary), `src/lib/mobile/registry/whatsapp.ts` (`whatsapp/summary`).
