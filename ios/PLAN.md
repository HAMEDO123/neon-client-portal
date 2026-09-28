# The NEON iOS app — plan, and what it needs from the server

Written on the Mac, 2026-09-28, against the live server at
`https://clients.neonjo.com/api/mobile/*` (the `main` branch). Everything
below was called for real. Nothing in the app is mocked. Where the app
needs something the server does not have, it says so here rather than
inventing a stand-in.

## 1. What the server actually answered

```
POST /login  {"password":"wrong"}                → 401   (route live)
POST /login  {"password":<admin>}                → 200 {"token","side":"ADMIN","name":"Manager"}
GET  /me                  (admin token)          → 200 {"side":"ADMIN","name":"Manager"}
GET  /today               (admin token)          → 401   (employee-only, by design)
GET  /tasks, /notifications (admin token)        → 401   (employee-only, by design)
GET  /projects                                    → 405   (no GET — see §5.8)
GET  /dashboard           (admin token)          → 200 {"stats":{total,published,pendingApprovals,recentlyUpdated},
                                                        "projects":[{id,name,clientName,location,publishState,
                                                        pipelineStatus,coverImageUrl,updatedAt,approvalsCount,commentsCount}]}
GET  /chat/conversations  (admin token)          → 200 {"viewer":{"side","name"},
                                                        "conversations":[{"conversation":{"kind":"team"|"direct",…},
                                                        "slug","title","subtitle","avatar","isGroup",
                                                        "last":{kind,body,durationSeconds,attachmentName,authorName,mine,createdAt},
                                                        "unread"}]}
GET  /chat/messages?conversation=team&take=200   → 200 {"messages":[{id,authorType,authorId,authorName,kind,body,
                                                        attachmentUrl,attachmentName,attachmentType,attachmentSize,
                                                        durationSeconds,managerOnly,createdAt,project:{id,name}|null,
                                                        task:{…card, assignments:[{id,employeeId,state,employee,submissions}]}|null,
                                                        call:{kind,endReason}|null, meeting:{…}|null, pinnedAt, pinnedByName}]}
                                                   101 messages: TEXT 82 · IMAGE 11 · CALL 4 · FILE 2 · VOICE 1 · TASK 1
```

**Still to record:** the employee-side shapes (`/login` with an email,
`/me`, `/today`, `/tasks`, `/tasks/[id]`, `/notifications`). They need a
team member's credentials. The app's models for them are read straight off
the server's `select`s (`src/lib/employee-tasks.ts` `taskSelect`,
`now-next.ts` `NowNext`, `employee-badges.ts`), and every field the server
can leave out is optional. They get confirmed the first time somebody on
the team signs in.

## 2. The decision: extend NeonAdmin, one app for both sides

`/login` already answers with `side`, and the chat routes already serve both
sides, so one app can be both. A second target would mean two builds to
sideload, two copies of the design system, the chat and the API client, and
two of everything to keep in step. The target is still called `NeonAdmin`
(CI and the IPA name depend on it); what people see is "NEON".

- `side: "ADMIN"` opens **Projects · Chat**
- `side: "EMPLOYEE"` opens **Today · Tasks · Chat · Alerts**

## 3. Screens, and what each is built on

| Screen | Endpoints | Notes |
|---|---|---|
| Sign in | `POST /login` | Team (email + password) or Manager (password only). The email is remembered; the password never is. |
| **Today** (team) | `GET /today`, `GET /me` | Warnings pinned at the top, **with no way to dismiss them**. The now/next card uses the web's own `headline` wording: "The day starts at 11:00", "Nothing planned for today". A quiet day is never shown as idleness. Today's and tomorrow's work below. |
| **Tasks** (team) | `GET /tasks?filter=open\|completed\|all` | Ownership is decided on the server (`ownedBy`). The app only mirrors it. |
| Task detail | `GET /tasks/[id]`, `POST /tasks/[id]/status`, `POST /tasks/[id]/proof` | What to hand in, what counts as done (cell first, else the step's standard, as in `effectiveDetail`), proof to send, checklist, waits for, blocked, the manager's note. Actions: **Start**, **Put back**, **Send proof**. **There is no Done button**, and no bare `SUBMITTED` is ever sent: the proof route puts work in review. |
| Send proof | `POST /tasks/[id]/proof` (multipart `photo` + `note`) | Camera, Photos or Files (image, PDF, DWG, XLSX, ZIP). What to photograph is shown *above* the camera, and so is what it will be checked against. Photos are shrunk to 2400 px (the server keeps no more). |
| **Chat** (both) | `GET /chat/conversations`, `GET/POST /chat/messages`, `POST /chat/read` | Text as JSON; photos (`photo`) and files (`document`) as multipart. Every message is laid out by its own first strong letter (the web's `dir="auto"`). Task cards show each person's part; **your own open part gets "Send proof"**, using the assignment id the proof route accepts. Meeting cards are read-only. |
| **Alerts** (team) | `GET /notifications`, `POST /notifications/read` | Tapping marks one read and opens its task. "Mark all read". The tab badge comes from `/me` `badges.unread`. |
| **Projects** (manager) | `GET /dashboard`, `GET/PATCH /projects/[id]`, comments, gallery, cover | The existing NeonAdmin screens, unchanged. |

**Rules the app keeps:**
- **The token lives in the Keychain**, never UserDefaults or a file. A token an older build left in UserDefaults is moved across once, and the old copy is deleted.
- **A 401 means signed out.** The token and every cached screen are wiped, and the sign-in screen says "You have been signed out". The app does not retry.
- **Offline is marked, never passed off as current.** Each GET's last answer is kept on disk in Caches. When the server can't be reached, the screen shows that copy under an "Offline — showing what the server said at …" banner, with actions switched off. The cache is wiped on every sign-in and sign-out.
- **No mock data or demo mode.** The one fixture is the Debug-only `-uiTestMode` dashboard that CI screenshots, which predates this work and is compiled out of Release builds. In that mode, every other call fails as offline rather than inventing data.
- Badges move by polling: `/me` every 30 s, the conversation list every 15 s, an open conversation every 4 s. See §5.2 for why.

## 4. Distribution: what stays and what would change

The app stays **unsigned for devices and sideloaded with AltStore**, exactly
as CI builds it. Simulator builds are now signed locally ("Sign to Run
Locally", no Apple ID). Without that, the simulator's Keychain refuses the app
and the session is lost on every relaunch. Phones are unaffected, because
AltStore signs the app.

To go to TestFlight / Apple Business Manager instead:
- sign with the paid team (`745F9U99BC`) and switch to a bundle id you own (e.g. `com.neonjo.staff`);
- add the Push Notifications capability and an APNs key;
- the camera usage string is already in (`NSCameraUsageDescription`), and the photo picker needs none;
- App Store privacy answers: the app collects photos and files the user chooses, and account email.

The public App Store is a poor fit: review needs a demo account, which would
expose real payroll and chat.

An older Mac branch, `ios-app` (12 commits, not merged), went down the
TestFlight road. It includes **server changes that are not on `main` or
live**: APNs inside `dispatchNotification`, `/api/mobile/devices`, different
chat routes (`/chat/[conversation]`), and meetings RSVP. This app does not
use any of it. Whether any of that server work is wanted is a Windows-side
decision.

## 5. What is missing — requests for the server

**Calls and the manager's tasks** are the two biggest gaps, and
`ios/SERVER-REQUEST.md` is a paste-ready request for both. The web's call
routes (`/api/calls*`) accept only a browser session plus a same-origin
check, and reviewing, the day board and handing out work are `requireAdmin`
server actions. None of these can be called from the app's API client.

**Until those routes exist, the app opens the website's own page for them,
inside the app and already signed in** (`WebPortal.swift`). This works
because the app's token *is* the website's session cookie value
(`createSessionToken` / `createEmployeeSessionToken`). The page runs on the
website's origin, so the website's own checks apply unchanged. The cookie
sits in a non-persistent store, so it is gone when the page closes.
- Phone and camera buttons in every conversation → the website's chat, where calls start or join. Mic and camera permissions are in `project.yml`.
- **Tasks** tab (manager) → the website's Task board and Reviews, "Hand out a task", and a native list of every task card from every chat (Open · To review · Done).
- **Meetings** tab (both sides) → a native list of every meeting card, with Join (from ten minutes before) and Answer opening the website's chat. "Set a meeting" is for the manager only.
- Tasks tab (team) → a native "Handed out in chat" list with Send proof, and "My week on the web".

These are a bridge. When the routes in `SERVER-REQUEST.md` are live, each of
them becomes a native screen. A call started this way rings only while the
page is open, just as it does on the web.

Each of these is a server change, to be made on the office PC. The app works
without them, and it doesn't fake any of them.

### 5.1 Jobs handed out by hand are not listed
`/tasks` returns board cells only. An `AssignedTask` (the week board, or a
task card in chat) can be *proved* through `/tasks/[id]/proof`, but the
only way the app can find one is by scrolling to its card in a chat.

```
GET /api/mobile/jobs?filter=open|completed|all        (employee token)
→ 200 { "jobs": [ { "id", "title", "note", "startDay", "endDay", "state", "priority",
                    "deliverable", "acceptance", "estimateHours", "blockedReason",
                    "chatTaskId": string|null, "completedAt" } ] }
GET /api/mobile/jobs/[id]  → 200 { "job": {…same…} }   · 404 when not theirs
POST /api/mobile/jobs/[id]/status { "state": "TODO"|"IN_PROGRESS" }  (same canMove rules)
```
`/today`'s `nowNext` blocks already carry `jobId`, so the app would link them
as soon as this exists.

### 5.2 No push
There is no APNs key and nowhere to store a device token. A free-Apple-ID
AltStore install cannot receive push at all, so this only matters on a paid
team.
```
POST   /api/mobile/devices  { "token": "<hex>", "platform": "ios", "environment": "sandbox"|"production" }
DELETE /api/mobile/devices  { "token": "<hex>" }            (on sign-out)
```
…plus APNs as a second transport inside `dispatchNotification`, and the
`.p8` key in the env. Until then, badges come from polling.

### 5.3 The manager cannot review proof from the phone
The card says "Proof waiting for your review on the web".
```
GET  /api/mobile/reviews → 200 { "submissions": [ { "id", "imageUrl", "note", "createdAt",
       "employee": {id,name}, "subject": { "kind": "entry"|"assigned", "id", "name" },
       "checks": [ { "criterion", "verdict", "evidence", "gap" } ] } ] }
POST /api/mobile/reviews/[submissionId] { "decision": "approve"|"reject", "note"?: string }
     → 200 { "ok": true, "state": "DONE"|"IN_PROGRESS" }   (approveSubmission / rejectSubmission)
```

### 5.4 Meetings can be read, not answered
```
POST /api/mobile/meetings/[id]/rsvp { "rsvp": "ACCEPTED"|"DECLINED" } → 200 { "ok": true }
```
Joining a meeting call is WebRTC in the browser. A native call would be a
separate project (CallKit + WebRTC).

### 5.5 Task-card threads and follow-up answers
```
POST /api/mobile/chat/tasks/[cardId]/comments { "body" } → 200 { "comment": {…} }
POST /api/mobile/follow-ups/[id] { "answer": "STARTED"|"NEED_INFO"|"BLOCKED"|"MORE_TIME"|"DONE"|"PARTLY"|"NOT_STARTED" }
```
Follow-up questions arrive as notifications whose answer lives on the web
task page. The app can show the notification but cannot answer it.

### 5.6 Chat is polled
`/chat/messages` has no `since`, so every poll re-reads the last 150
messages. Either of these would make it cheap:
```
GET /api/mobile/chat/messages?conversation=…&since=<ISO>   → only newer messages
```
or a bearer-token version of the SSE stream at `/api/chat/stream`.

### 5.7 Files on `r2.dev`
Every attachment and cover is a `https://pub-….r2.dev/…` URL. From the Mac
this was built on, the TLS handshake to that host fails outright, while
`clients.neonjo.com` answers normally. So on this network, chat photos and
project covers show their placeholder. Cloudflare's own docs say `r2.dev`
URLs are rate-limited and not meant for production. The fix is a custom
domain on the bucket (e.g. `files.neonjo.com`) as `R2_PUBLIC_URL`. Existing
rows keep their `r2.dev` URLs, so they would need rewriting, or `r2.dev`
left on.

### 5.8 Smaller things
- `GET /api/mobile/projects` does not exist (405). The project list comes from `/dashboard`. `ios/PROMPT.md` lists it as live.
- Voice notes are WebM/Opus, which iOS can't play inside an app. They open in Safari. An AAC/M4A copy at upload would let the app play them in place.
- **No mobile routes** exist for the WhatsApp inbox, site-visit diary, payroll, attendance, reviews (§5.3), the week board, the daily report, requests or the employee project tabs. These screens are web-only for now.

## 6. Running it

```
cd ios && xcodegen generate
xcodebuild -project NeonAdmin.xcodeproj -scheme NeonAdmin -sdk iphonesimulator \
  -configuration Debug -derivedDataPath buildsim \
  -destination "platform=iOS Simulator,name=iPhone 17" build
xcrun simctl install booted buildsim/Build/Products/Debug-iphonesimulator/NeonAdmin.app
xcrun simctl launch booted com.neon.admin
```
No credentials are in the source or the repo. Sign in on the device.
