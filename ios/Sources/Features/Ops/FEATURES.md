# Ops area — feature inventory

Read from the website: `src/app/admin/(dashboard)/{attendance,requests,site-visits,settings}/page.tsx`,
`src/components/admin/{attendance-console,device-users,attendance-month}.tsx`,
`src/components/tasks/site-visits.tsx`, `src/lib/{attendance-device,attendance-store,
attendance-sync,attendance-month,site-visits,site-visit-queries,automation,work-hours,
push-health,manager-account}.ts`, `src/lib/actions/{operations,site-visit,settings,
automation,admin-push}-actions.ts`.

## webFeatures (every screen/field/button/state found)

**Attendance device** (`/admin/attendance`)
- Device address, reachability, its wall clock, drift seconds, degrades (doesn't fail) when unplugged
- "Sync today" (asks the device now; reports punches/created/updated/keptManual/skippedInactive/unmapped)
- "Set its clock" (reports the new reading and drift)
- Enrolled users table: device number, name on device, device-admin flag, whether paired in the platform, to whom
- Add a user to the device (number + name) — creates the record only, not the fingerprint
- Remove a user from the device (by uid, not userId) — also unpairs here
- Pair/unpair an employee to a device number (unique; re-pairing moves it off whoever had it)
- Wipe the device's log — guarded by typing WIPE, irreversible
- Month grid: people × days, `?month=YYYY-MM`, hours late per cell, note, MANUAL/DEVICE source
- "An empty cell means nothing was recorded" note

**Requests** (`/admin/requests`)
- Today's daily reports: one card per active employee, their text (or "hasn't written yet")
- Supply requests: pending (item, quantity, urgent flag, requester, cost estimate, note) → Approve/Decline with an optional decision note
- Decided requests table (status badge, decided date); Approved → "Mark bought"

**Site visits** (`/admin/site-visits`, `components/tasks/site-visits.tsx`)
- Manager: reads every visit, three groups (not written up yet / coming up / done), never answers for one
- Team member with `canLogSiteVisits`: their own diary
  - Schedule a visit: title, when, location, project (optional), purpose
  - Edit a visit (only while PLANNED)
  - Answer VISITED ("I went") or MISSED ("Did not go") — report text required
  - CANCELLED — no report required (server-supported; the website itself exposes no button for it, the app adds "Call off" since the action allows it)
  - Delete (only while PLANNED)
  - "Not written up yet" / "awaiting report" wording, never implies somebody missed a visit

**Settings** (`/admin/settings`, minus the delivery process — tasks area's `ProcessSettingsView()`)
- Push health: server keys configured/source, devices with active/retired counts, recent deliveries
- The manager's own device pairing status (read; see notImplemented)
- The working day: working days, start/end, lunch at/minutes, margin, grace minutes; derived day length/capacity/on-time cutoff
- How we plan a day: free-text planning notes
- Rules that watch the day (automation): list, enabled toggle per rule, studio-wide switch, create/edit/delete, `?preview=rules` (writes nothing)
- Company channel / WhatsApp: transport, connected, number, status detail
- Sending detail: transport config, a free-text test message (see notImplemented)
- Company timezone picker
- Other integrations: AI assistant/receipt reading configured, push configured

## Built natively

- `AttendanceRootView()`: device status card, sync/set-clock console, enrolled-users
  management (add/remove with confirmation), pairing (per-employee sheet), wipe log
  (typed WIPE), and a month view — a per-person summary (days recorded, hours late)
  that drills into that person's day-by-day list, rather than the desk-oriented
  people×days grid, since that doesn't fit a phone. The "empty means nothing
  recorded" note is carried over verbatim, on both the summary and the per-person
  view.
- `RequestsRootView()`: today's reports, pending/decided supply requests, approve
  (with note)/decline (with note)/mark bought.
- `SiteVisitsRootView()`: branches on `api.identity.side`. Manager: read-only,
  grouped exactly as the website orders them. Team member: schedule/edit/answer
  (VISITED/MISSED with a required report)/call off (CANCELLED)/delete.
- `SettingsRootView()`: push health (read-only diagnostic, with an explicit note
  that this build cannot receive push at all — see notImplemented), the working
  day form, planning notes, automation rules (full CRUD + switch + preview),
  WhatsApp status (summary, with a link into the WhatsApp area's own
  `WhatsAppRootView()` for linking/unlinking and the inbox itself), timezone,
  AI/push integration status, and a link to the tasks area's
  `ProcessSettingsView()`.
- **Manual attendance correction** (`AttendanceCorrectionSheet`, on top of the
  month drill-down): add, edit or remove one person's day — `setAttendance`/
  `deleteAttendance`, the payroll screen's own actions
  (`admin/(dashboard)/payroll/page.tsx`), exposed here since this area owns the
  app's attendance screens. The website's rules travel unchanged: written as
  MANUAL either way (a manager's figure wins, and correcting a device day
  re-marks it MANUAL so the next sync leaves it alone), both hours clamped to
  0–24 server-side.

## notImplemented (with reasons)

- **Registering this phone for push** (`admin-push-actions.ts`,
  `saveAdminPushSubscription`/`removeAdminPushSubscription`): these take a Web
  Push subscription object from a browser's `PushManager`; there is no iOS
  equivalent without APNs, and `ios/ARCHITECTURE.md`/`AGENTS.md` confirm this
  build (signed for AltStore) cannot register for push notifications at all. The
  Settings screen shows push health as a read-only diagnostic with an explicit
  note instead of a non-functional "enable" toggle.
- **The free-text test message** on the Settings page (`WhatsAppTest`): stays
  out of scope for this area's Settings screen. **WhatsApp linking (QR code /
  pairing code)** itself is no longer "web-only" from here — the status card
  now links straight to the WhatsApp area's own `WhatsAppRootView()`, which
  owns the studio's WhatsApp inbox and its linking flow, rather than this
  screen saying it cannot be done from the app.

## Faces
- The attendance month's people (`ops/attendanceMonth` `photos`, a map beside
  the rows), today's reports and who has not written one (`ops/requests`
  team's `photoUrl`), a supply request's asker, a site visit's owner, and the
  push list in Settings (`ops/settings` `faces`) draw each person's photo,
  initials where there is none.
