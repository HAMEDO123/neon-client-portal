# WhatsApp area — feature inventory

Web sources read: `src/app/admin/(dashboard)/whatsapp/page.tsx`,
`src/app/employee/(portal)/whatsapp/page.tsx`, `src/components/whatsapp/whatsapp-inbox.tsx`,
`src/components/admin/channel-cards.tsx`, `src/components/admin/whatsapp-test.tsx`,
`src/lib/actions/whatsapp-actions.ts`, `src/lib/whatsapp/{index,worker,cloud-api}.ts`,
`src/app/api/whatsapp/{chats,media,chats/[chatId]/{messages,send}}/route.ts`, and the
"Company channels" / "Sending" sections of `src/app/admin/(dashboard)/settings/page.tsx`.

Both the admin and employee WhatsApp tabs mount the exact same component behind
the exact same guard (`requireWhatsAppAccess`), so this is one inventory for both.

## Inbox (both sides, `requireWhatsAppAccess`)

- [x] Conversation list: avatar (group vs. person icon), name or number
      ("Unknown" if neither), last-message preview ("You: …" when `fromMe`,
      else the attachment's type name when there's no body), unread badge.
- [x] Search chats by name, number or last-message text.
- [x] Manual refresh + auto-refresh (web: every 20s and on window focus; app:
      every 20s while the screen is mounted — a phone has no "focus" event,
      pull-to-refresh stands in for the deliberate refresh).
- [x] "Not linked yet" state (distinct copy, and for the manager a way straight
      into Settings) vs. a generic worker error, never an empty list.
- [x] Opening a conversation does not mark it read on the phone (no `sendSeen`
      call exists anywhere in this app, matching the worker never being told).
- [x] Thread: header (avatar/name/number or "Group"), messages oldest-first,
      auto-refresh every 10s.
- [x] Bubbles: mine on the trailing side, author name on a group message
      that isn't mine, per-bubble time in the studio's own timezone (never the
      phone's), a wordless message shows what it was ("Photo", "Voice note", …).
- [x] Attachments: an image/sticker shown inline (`WhatsAppMediaImage`, an
      authenticated fetch — the media route takes a bearer token, which
      `RemoteImage`/`AsyncImage` cannot attach); every other kind (document,
      video, audio, ptt, location, vcard, multi_vcard, revoked,
      e2e_notification, notification_template, call_log) as a row
      (`WhatsAppAttachmentRow`) with its icon and name. Tapping it downloads
      once and hands the file to the system's own share sheet (Quick Look,
      Save to Files, "Open in…") — never a web view.
- [x] Pending "Sending" bubble immediately after a send, reconciled against the
      next poll by text + a two-minute window (`stillWaiting`, ported as-is).
- [x] Composer: grows with the text, Send button, 4000-character limit,
      disabled state and inline error surfaced exactly as the website words it.
- [x] Groups are read-only: the composer is replaced with the website's own
      explanation, since the worker cannot post into a WhatsApp group.
- [x] Empty state ("Nothing in this chat yet."), loading state, error + Retry.

## Settings (manager only, `requireAdmin` — the "Company channels" / "Sending"
cards on `/admin/settings`, reachable here from the WhatsApp tab's own gear
icon rather than through the Ops area's `SettingsRootView`, since the registry
entries and the guard for linking are this area's)

- [x] Channel card: Linked/not-linked, the linked number, Link / Unlink
      (confirmed) buttons.
- [x] Link panel: QR code (decoded from the server's data URL) or a pairing
      code (large, monospaced) to enter by hand, phone field for "link by
      code", polling every 2.5s until connected then closing itself, an error
      state with Retry, a "waiting for the scan" line.
- [x] Transport detail: which transport is active (Cloud API vs. the session
      worker vs. none), the phone-number id / worker URL / line, the
      connection's own status sentence, a badge for at a glance.
- [x] Send-a-test form (phone + message, outcome sentence).
- [ ] The setup instructions block (the env-var names to add when nothing is
      configured) — informational only on the website (nothing to click), and
      an app has no `.env` to point at; the "not configured" badge and the
      transport card's empty state cover the same ground in fewer words.

## Not part of this area

Voice/video calls from a conversation are the calls area's `CallButtons` —
this area has neither a website call button to replace nor a route to call.
The company timezone, on the same settings page, belongs to whichever area
ends up owning the rest of `/admin/settings`.
