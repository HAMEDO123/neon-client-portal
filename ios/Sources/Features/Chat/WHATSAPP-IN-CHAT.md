# The company WhatsApp, inside the chat list (server side is done)

Hand this to Claude on the Mac. The server half is live on
`https://clients.neonjo.com`.

**This replaces the first version of this brief**, which asked for one pinned
"WhatsApp" row that opened the inbox. That was built on the website, and the
studio sent it back the same day.

## What the studio asked for

> I want the company's WhatsApp to be in the same chat as the team's.

Asked which shape that meant, the answer was: **each client is a row in the
chat list**, mixed with the team's conversations, ordered by the last message,
opening as a conversation in the same place, and answered from there.

The website does this now, on both sides. The app's own chat list does not yet.

## What is already true, with no app change

- **Everybody on the team has it.** `canReadWhatsApp` is on by default; `/me`
  carries it. The manager can still untick one person, so keep reading the flag.
- **Everybody is told** when a client writes: `NotificationType`
  `WHATSAPP_MESSAGE`, title `WhatsApp · <who>`, within a minute.
- **Photos, voice notes, videos and stickers open again.** They had all stopped
  (a change at WhatsApp's end; only documents still opened), which is the grey
  boxes in `WhatsAppMediaImage` the owner sent a screenshot of. Fixed in the
  worker on 2026-10-06 — nothing in the app was wrong.
- **`GET /api/mobile/whatsapp/media/<id>` now hands over something the phone
  can use:**
  - a voice note (`ptt`, `audio`) arrives as **AAC in an `.m4a`**
    (`audio/mp4`), not WhatsApp's Ogg Opus, which iOS will not play;
  - every file has a **name with an extension** in `content-disposition`
    (`photo.jpg`, `video.mp4`, `voice-note.m4a`, or the sender's own name),
    still as `filename*=UTF-8''…` with an ASCII stand-in beside it;
  - `Range` is answered (206), so an `AVPlayer` pointed at the URL can stream.

## The app's half

### 1. A row per client in `ChatListView`

One read, which answers at once (it never asks the worker):

    GET /api/mobile/get/whatsapp/summary

    { "checkedAt": 1791280800000,
      "unreadChats": 4,
      "latest": { "title": "Abu Mohammad", "preview": "مرحبا…",
                  "at": 1791280740000, "fromMe": false },
      "rows": [
        { "id": "962790000001@c.us", "title": "Abu Mohammad",
          "preview": "مرحبا…", "at": 1791280740000,
          "unread": 2, "fromMe": false, "isGroup": false }
      ] }

- `null` means no linked number: draw no rows. A person without
  `canReadWhatsApp` gets 403: draw no rows.
- `rows` are the forty most recently active conversations, newest first, none
  archived. `at` is **milliseconds**. `unread` is the handset's own count, and
  `-1` means "marked unread" there — draw a dot with no number.
- `preview` is their words, or what was sent ("Photo", "Voice note" …). Prefix
  `You: ` when `fromMe`.
- Refresh when the list refreshes and on `.neonDataChanged`. The rows move at
  most once a minute.

**Order, exactly as the website's** (`mergeChatList` in
`src/lib/whatsapp-watch.ts`, with tests that say why):

1. what the person pinned, as it already is — a WhatsApp chat cannot be
   pinned, so nothing of it goes above a pin;
2. everything with a last message, the team's and the clients' together,
   newest first (a tie keeps the team's row first);
3. colleagues nobody has written to yet, last.

**The row** is drawn like a conversation's — picture, name, last line, time,
count — with one difference that must survive a glance: **a green WhatsApp
mark on the picture**, and the count in green rather than the team's colour.
Answering there answers *as the studio's number*, so which kind of row it is
must never depend on recognising a name. Initials on a soft green circle for a
named chat, a person glyph for one known only by its number (title begins `+`
or a digit), a group glyph when `isGroup`.

It is **not** a `ConversationSummary`: no slug, no pin, no mute, no swipe
actions, no streak, no presence, and it must not go through `openChat`.

After the last row, one quiet line — "Older WhatsApp chats, and search" — that
pushes `WhatsAppRootView()`. The list carries the recent ones, not every chat.

### 2. Tapping a row opens that conversation

Push `WhatsAppThreadView` for `row.id`, from the chat tab's own stack, so Back
returns to the chat list. The thread reads `whatsapp/messages?chatId=` and
sends with `whatsapp/send` as it already does. A row carries enough for the
header (`title`, `isGroup`); the thread's own answer carries the name too.

### 3. Voice notes play in the thread

Today `WhatsAppAttachmentRow` downloads the file and opens the share sheet,
which for a voice note is three taps to hear four seconds. Now that the route
hands over `audio/mp4`, give `ptt` and `audio` messages an inline player — the
chat's own voice-message player if it can take a URL with a bearer header,
otherwise download to a temporary `.m4a` and play that. Fetch on tap, not on
appear: a conversation with forty voice notes must not download forty files to
draw forty play buttons. Videos can stay as they are (a tap opens them).

A photo that fails to load should say so and offer a retry, not stay a grey
box: that box is what every attachment showed while the worker could not read
them, and it reads as "still loading".

### 4. Notification taps

The link is unchanged: `/employee/whatsapp?chat=<chatId>` for the team and
`/admin/whatsapp?chat=<chatId>` for the manager (the id is URL-encoded and
contains `@`). **Today `PushRoute` sends both to the More tab.** They should
land on the Chat tab with that conversation pushed — `ChatListView`'s
`openFromNotification` is where the chat tab already reads a pending path.
On the website the same link is passed on to `/…/chat/wa/<id>`; the app does
not need to know that address.

### 5. `NotificationsView`

An icon and colour for `WHATSAPP_MESSAGE` (and for `SITE_VISIT`, which has had
none since it was added).

## Do not

- Do not mark anything read. Opening a chat must not clear the unread badge on
  the handset — the worker never calls `sendSeen`, on purpose. So a row's count
  clears when somebody reads it on the phone, or answers; not when it is opened
  here.
- Do not post into groups: the server refuses, with a sentence. Show it, and
  show no message box in a group's thread.
- Do not call `whatsapp/inbox` to draw the chat list. It asks the worker, a
  browser in another container; `whatsapp/summary` is the stored copy and is
  the one the list is for.

Server files: `src/lib/whatsapp-watch.ts` (rows, order, what counts as a new
message — pure and tested), `src/lib/notifications/whatsapp-events.ts` (the
minute's look, which stores the rows), `src/lib/mobile/registry/whatsapp.ts`
(`whatsapp/summary`), `src/lib/whatsapp-attachments.ts` and
`src/lib/whatsapp-media.ts` (what an attachment is handed over as).
