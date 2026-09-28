# The NEON iOS app — architecture and the rules every area follows

The app is the studio's platform as a native iPhone app, for the manager and the
team: everything the website does, done natively, with no web views. The data is
the live server's (`https://clients.neonjo.com`), always. This file is the
contract the feature areas are built to, so they can be built at the same time
without stepping on each other.

## 1. How the app reaches the server

The website is server components reading `src/lib` queries, and server actions
for every button. The app reaches the same code through two routes and a
registry (`src/lib/mobile/rpc.ts`, `src/lib/mobile/registry/`):

```
GET  /api/mobile/get/<area>/<name>?…   → the JSON value the read returns
POST /api/mobile/do/<area>/<name>      → { ok: true, result, redirect }  |  { error } with 400/403/404/409/500
     JSON body:      { "args": [...], "form": { field: value | [values] } }
     multipart body: "__args" (JSON array) + the form's own fields and files
```

- **Sign-in is the website's own.** The app's token is the value the website
  keeps in its session cookie. `src/lib/session-token.ts` lets every guard
  (`requireAdmin`, `requireStaff`, `requireEmployee`, `requireTaskAssigner`,
  `requireWhatsAppAccess`, `requireSiteVisitor`, `getChatViewer`) accept it from
  an `Authorization: Bearer` header as well as from the cookie. Nothing was
  loosened, and nothing is copied.
- **A read** is `guarded(<the guard the website page is behind>, async (params, who) => …)`.
  It calls the same `lib` queries the page calls. If a page computes something
  inline in its `page.tsx`, reproduce that query inside the registry file,
  importing the same lib helpers. Never edit the page.
  `tests/mobile-registry.test.ts` fails any read that isn't `guarded(…)`.
- **An action** calls the website's own server action from `src/lib/actions`.
  Its guard, rules, notifications, state log and revalidation come with it.
  - Map arguments with the rpc helpers: `str`, `optStr`, `num`, `optNum`, `bool`, `oneOf`, `strArray`.
  - If the action takes `FormData`, pass `input.form`.
  - Only when there is no server action (the logic lives in a route handler or a lib function) is it `guardedAction(<guard>, …)`.
- **Errors mean what they say.** A guard's refusal on these routes is **403**,
  never 401: the app signs out only on a real 401. The website's `redirect()`
  after a save arrives as `redirect: "/admin/projects/<id>"`. An Error thrown
  with a sentence reaches the phone as that sentence.
- **Dates arrive as ISO strings. `null` stays `null`.** Swift models make every
  nullable field optional.
- **Streams** (calls, a chat's live updates) cannot be a registry read. Those
  areas add dedicated routes under `src/app/api/mobile/<area>/…` that read the
  viewer with `mobileViewer(request)` from `src/lib/mobile-auth.ts`.

**Server rules for every area.**
- Add entries only to your own `src/lib/mobile/registry/<area>.ts`, with keys
  `<area>/<name>`. Create new helper files only as `src/lib/mobile/<area>-*.ts`.
- **Do not edit existing server files**: pages, components, actions, lib,
  schema, migrations. If something truly cannot be done without an edit, say
  so in your report rather than doing it.
- Verify with `npx tsc --noEmit`, `npx eslint <your files>` and
  `npx tsx --test tests/mobile-registry.test.ts`.

## 2. The app's layout

```
ios/Sources/
  App/        the root, the tab bars, More, sign-in             (integration)
  Core/       APIClient, TokenStore, Localization, Formatting   (integration)
  UI/         the design system and components                  (UI kit)
  Features/
    Home/          manager home, alerts, reviews, analytics
    Projects/      project list, project page, overview, gallery, hotspots, project analytics
    ProjectFiles/  drawings, documents, BOQ, pricing, materials, furniture, approvals, comments
    Tasks/         the board, cell editor, week board, the delivery process
    Team/          employees, an employee's page, payroll, day plans
    Ops/           attendance, requests (manager), site visits, settings
    Chat/          conversations, a conversation, task & meeting cards, reactions, pins, voice, assistant, meetings
    Calls/         native voice/video calls (WebRTC), incoming-call overlay
    WhatsApp/      the studio's WhatsApp inbox
    Me/            the team's own side: today, tasks, jobs, requests, daily report, follow-ups, profile, assign
ios/Resources/ar.lproj/
  Localizable.strings   core strings
  <Area>.strings        one Arabic table per area. L() searches them all.
```

**App rules for every area.**
- **Your files only:** `ios/Sources/Features/<Area>/` and `ios/Resources/ar.lproj/<Area>.strings`.
  Do not edit `App/`, `Core/`, `UI/` or another area. The calls area alone may
  add its Swift package to `ios/project.yml`.
- **Talk to the server with `api.read("area/name", ["key": value], as: T.self)`**,
  which returns `Loaded<T>`. `cachedAt != nil` means offline: show
  `OfflineBanner` and switch actions off.
- **Change things with `api.perform("area/name", args: [...], form: [...])`**, or
  `api.performUpload(…, files:)` for files. Put these calls in an
  `extension APIClient` in your own folder.
  - Every successful action posts `.neonDataChanged` with its name; re-read when something you show has changed.
  - Show the server's refusal sentence (`error.localizedDescription`), not a generic one.
- **Text a person wrote** (names, notes, messages, titles) goes through
  `DirText`, which lays it out in its own direction. Every UI string goes
  through `L("English")`, with its Arabic added to your `.strings` file.
  `plutil -lint` it.
- **The deployment target is iOS 16.** Guard iOS 17 APIs (`symbolEffect`,
  `ContentUnavailableView`, …) with `if #available`. Use `onChange` in its
  one-parameter form.
- **Navigation.** A tab root owns a `NavigationStack`. A screen pushed from
  More (`…RootView` below, except the tab roots) does **not** wrap itself in
  one. Sheets do.
- **No web views, and no "open in browser" for anything the app should do
  itself.** Opening a file or an external link (wa.me, a PDF on storage) in
  the system is fine.
- **Build:** `cd ios && xcodegen generate && xcodebuild -project NeonAdmin.xcodeproj
  -scheme NeonAdmin -sdk iphonesimulator -configuration Debug -derivedDataPath
  buildsim -destination 'generic/platform=iOS Simulator' build` must say
  `BUILD SUCCEEDED`.

## 3. Contracts between areas (keep these names and shapes)

| Name | Owner | Used by |
|---|---|---|
| `AdminHomeView()` (tab root) | home | App |
| `AlertsRootView()`, `ReviewsRootView()`, `AnalyticsRootView()` (pushed) | home | App/More |
| `ProjectsRootView()` (tab root, both sides) | projects | App |
| `ProjectDrawingsSection(projectId:)` … `ProjectCommentsSection(projectId:)`: Drawings, Documents, Boq, Pricing, Materials, Furniture, Approvals, Comments (embedded, no stack) | projectfiles | projects |
| `TasksRootView()` (tab root, manager) · `ProcessSettingsView()` (pushed) | tasks | App, ops |
| `EmployeesRootView()`, `PayrollRootView()` (pushed) | team | App/More |
| `AttendanceRootView()`, `RequestsRootView()`, `SiteVisitsRootView()`, `SettingsRootView()` (pushed; site visits serves both sides) | ops | App/More |
| `ChatListView(onUnreadChange:)` (tab root) · `ChatRoute(slug:title:subtitle:avatar:isGroup:)` · `ChatRoomView(route:)` · `ChatCardsLoader` · models in `ChatModels.swift` (additive changes only) · `MeetingsView()` (pushed) | chat | App, tasks, me |
| `CallButtons(slug:title:)` (in a conversation's header) · `CallOverlay()` (mounted at the root) | calls | chat, App |
| `WhatsAppRootView()` (pushed) | whatsapp | App/More |
| `TodayView()`, `TasksView()` (tab roots, team) · `NotificationsView(openChat:)`, `MyRequestsRootView()`, `AssignRootView()`, `ProfileRootView()` (pushed) · `ProofSheet(targetId:title:subtitle:evidence:acceptance:onSent:)` + `ProofTarget` · `StaffStore` | me | App, chat |

## 4. What the studio insists on (from `ios/PROMPT.md` and the platform)

- **"Done" is the manager's word.** The team hands in proof, and nothing ever
  lets somebody complete their own work.
- **Silence is never a verdict.** An unanswered question is shown as
  unanswered, never as "did nothing".
- **Warnings are pinned and cannot be dismissed.** An empty day says "Nothing
  planned for today", and outside working hours it says the hours.
- **No mock data, no demo mode, no local store of record.** A cache of what the
  server said, marked as such, is fine.
- **English and Arabic,** with every piece of user text in its own direction.
