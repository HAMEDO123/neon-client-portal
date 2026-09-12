# NEON — the studio's platform

One Next.js app runs NEON's interior-design studio. It is live at **https://neon-client-portal.onrender.com**.

| Who | Where | What |
|---|---|---|
| Clients | `/p/<token>` | A project's page: renders, drawings, documents, BOQ, pricing, materials, furniture, approvals, comments and downloads. There is no login; the link is the key. |
| The manager | `/admin` | Projects, the team's task board and week board, reviews, alerts, chat, analytics, payroll, requests, employees and settings. |
| Employees | `/employee` | A phone web app added to the Home Screen: the day's work, photo proof, chat, requests and push notifications. |
| The manager, native | `ios/` | "NeonAdmin", a small SwiftUI app that talks to `/api/mobile/*`. It is sideloaded with AltStore. |
| WhatsApp | `whatsapp-worker/` | An optional separate service that sends messages from a linked WhatsApp number. |

**Stack:**
- Next.js 16.3 (App Router, server actions, Turbopack) and React 19
- Prisma 7 with `@prisma/adapter-pg`, on PostgreSQL
- Tailwind v4, `web-push` and `@anthropic-ai/sdk`
- Hosted on Render, which deploys every push to `main`

> **For agents:** CLAUDE.md imports this file, so it is in your context from the start of every session. Use it to find where things are without reading the codebase. Read the code itself before you change it. If you learn something that would have saved time, add it here.

---

## How the owner works (agents, follow this)

- **Push without asking.** Once a change is done and verified, commit it and push to `main`. Verified means `npx tsc --noEmit`, `npm run lint`, `npm test` and `npm run build` all pass. The owner, Hamed, tests on a phone against the live site, so an unpushed fix is one they can't see. Never force-push or rewrite history.
- **Confirm the deploy.** Every page's asset URLs carry `?dpl=<commit SHA>` (set by `deploymentId` in `next.config.ts`). The deploy is live when `curl -s https://neon-client-portal.onrender.com/employee/login | grep -oE 'dpl=[A-Za-z0-9]+'` matches `git rev-parse HEAD`, usually 2–3 minutes after the push. Then tell the owner.
- **Keep replies short and plain.** Requests are brief, sometimes in Arabic, and often come with phone screenshots. Answer in the language you were asked in.
- **Lint is clean.** `npm run lint` passes with 0 errors (a few unused-variable warnings remain), so an error you see is one you introduced. A component that needs the current time ticking uses `lib/use-minute-now.ts` — one shared clock read through `useSyncExternalStore`, rather than setting state in an effect, which `react-hooks/set-state-in-effect` refuses.
- **Next.js has breaking changes here.** This is not the Next.js you know (see AGENTS.md). Check `node_modules/next/dist/docs/` before using an API you're unsure of.

---

## Run it on a new computer (Windows)

1. Install **Node.js 22.9 or newer**. `npm test` uses `--env-file-if-exists`, which older versions don't have; the first computer runs 25.9. Also install **Git**, and VS Code with Claude Code.
2. Unzip the project, for example to `C:\Users\<you>\Projects\neon-client-portal`, and open that folder.
3. Run `npm install`. It also runs `prisma generate`.
4. Start the local database in its own terminal and leave it running: `npm run db:dev`. It prints connection addresses. `DATABASE_URL` in `.env.local` must be the `postgres://…@127.0.0.1:51214/template1…` one. If the port it prints is different, paste in the `postgres://` address it shows. The `prisma+postgres://` one won't work with this app.
5. Create the tables: `npx prisma migrate deploy`.
6. Load data. Either:
   - load the copy of the first computer's database: `node --env-file=.env.local scripts/restore-local-data.mjs` (it reads `local-backup/local-data.sql`), or
   - load only the demo project: `npm run db:seed`.
7. Run `npm run dev`, then open http://localhost:3010/admin or http://localhost:3010/employee. After seeding, the demo client page is http://localhost:3010/p/villa-al-fulan-2026-demo.
8. `git status` should be clean and `git log` should show the full history. The first `git push` asks you to sign in to GitHub.

`.env.local` and `local-backup/` hold passwords, API keys and employee records. Both are git-ignored. Keep them that way, and never send them anywhere.

**Moving the data again later.** The copy holds data only; the migrations create the tables. Making a new copy needs PostgreSQL's command-line tools (on the first computer they are in `C:\Program Files\PostgreSQL\18\bin`):

```
pg_dump --dbname="<DATABASE_URL from .env.local, with everything after ? replaced by sslmode=disable>" \
  --schema=public --data-only --column-inserts --disable-triggers \
  --exclude-table-data=_prisma_migrations --file=local-backup/local-data.sql
```

- `--schema=public` matters: `prisma dev` keeps a table of its own in another schema, and a new database doesn't have it.
- Load the copy with the restore script. Add `--replace` to empty the database first.
- The script refuses any database that isn't on this computer.

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Dev server on http://localhost:3010 (Turbopack) |
| `npm run db:dev` | Local PostgreSQL (`prisma dev --name neon-client-portal`, ports 51213–51216) |
| `npm test` | Every test in `tests/`. Database tests skip themselves when the DB is down. |
| `npm run test:db` | Only `*.db.test.ts`. Add `-- --test-concurrency=1` if they flake. |
| `npx tsc --noEmit` · `npm run lint` · `npm run build` | The other checks |
| `npm run db:seed` | Deletes and recreates the demo project |
| `npm run db:studio` | Prisma Studio |

**Adding a migration.** `prisma migrate dev` fails here because the shadow database already has the types. Diff and deploy instead:

```
npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script \
  -o prisma/migrations/<yyyymmddhhmmss>_<name>/migration.sql
npx prisma migrate deploy
npx prisma generate
```

- `--from-config-datasource` reads `DATABASE_URL` through `prisma.config.ts`, which loads `.env` and then `.env.local` (overriding).
- Production runs `prisma migrate deploy` every time it starts, so a migration ships with the push.
- **Never use `prisma db push`.** It changes only your own database, and the live one never gets the change. That is how `DrawingRevision` and `ImageHotspot` existed only locally until migration `20260910170000` created them.

---

## Deploy

- **Render** (`render.yaml`): one web service on the free plan in Frankfurt.
  - Build: `npm install --include=dev && npm run build`. Start: `npx prisma migrate deploy && npm run start`.
  - If a migration fails, the new version doesn't start and the old one keeps serving.
  - Environment variables live in the Render dashboard. Render generates `SESSION_SECRET` and `CRON_SECRET` itself.
  - A free instance sleeps when idle, so the first request after a pause is slow.
- **GitHub Actions:**
  - `daily-notifier.yml` calls `/api/cron/notifications` every hour at :05, with `Authorization: Bearer $CRON_SECRET`. It uses the repo secrets `APP_URL` and `CRON_SECRET`, and `CRON_SECRET` must match Render's.
  - `ios-build.yml` builds an unsigned IPA whenever `ios/**` changes.

---

## Map of the code

```
src/app/              routes: admin/(dashboard)/…  employee/(portal)/…  p/[token]/…  api/…
src/components/       admin/  employee/  client/  chat/  ui/  + live-sync, sound-cues, sound-toggle, viewport-readout
src/lib/              domain logic; pure modules are unit-tested; actions/ = server actions
src/generated/prisma  generated client (git-ignored). Import from "@/generated/prisma/client"
prisma/               schema.prisma, migrations/, seed.ts
public/               sw.js (push), manifests, icons, seed-images/, uploads/ (git-ignored local files)
tests/                node:test run through tsx; *.db.test.ts need the local database
scripts/              restore-local-data.mjs
ios/                  NeonAdmin SwiftUI app (XcodeGen spec in ios/project.yml; no .xcodeproj committed)
whatsapp-worker/      standalone WhatsApp Web service (its own Dockerfile; not in render.yaml)
```

### Sign-in and sessions
- There are two cookie sessions, `admin_session` and `employee_session`. Both are stateless, HMAC-SHA256 over `SESSION_SECRET`, and last 7 days (`src/lib/auth.ts`, `session-cookie.ts`). There is no middleware: layouts and actions check sessions themselves.
- **Admin:** one shared password, checked with bcrypt against `ADMIN_PASSWORD_HASH` (`lib/actions/auth-actions.ts`). The gate is `src/app/admin/(dashboard)/layout.tsx`.
- **Employee:** email and password on `Employee`. Login requires `active` and `accessRole === "EMPLOYEE"` (`employee-auth-actions.ts`).
  - `lib/employee-session.ts` (`requireEmployee`) re-reads the database on every request, so a disabled employee is out on their next click.
  - The employee id always comes from the session, never from an argument.
- One browser can hold both sessions. Chat resolves which one applies with a `side` argument (see Chat).
- Changing `SESSION_SECRET` signs everyone out, including the iOS app.

### Client portal and projects
- **Access:** `/p/[token]` opens only when `Project.publishState === "PUBLISHED"`; DRAFT and ARCHIVED projects show "Link Unavailable".
  - `token` is unique, and regenerating it kills the old link.
  - `pipelineStatus`, `currentStage` and `completionPercent` are labels the manager sets by hand.
  - Visibility flags: `showPricing`, `showDetailedPricing`, `showBoqQuantities`, `showBoqPrices`, `allowDownloads`, `watermarkEnabled`.
- **File routes:** `/p/[token]/dl/[kind]/[fileId]`, `/gallery.pdf` (pdf-lib and sharp) and `/handover.zip` (archiver). All three return 404 unless the project is published and `allowDownloads` is on.
- **Client actions:** `respondToApproval(token, …)` and `createComment(token, …)` check only the token.
- **Admin pages:** `src/app/admin/(dashboard)/projects/[id]/…` has one tab per section: gallery with hotspots, drawings with revisions, documents, BOQ, pricing, materials, furniture, approvals, comments and analytics. The layout holds `PublishControls` and `LinkActions` (copy, WhatsApp send, regenerate token).
- **Queries:** `lib/queries.ts` builds `fullProjectInclude`, which `getProjectById` and `getProjectByToken` share, giving the `FullProject` type.
  - `lib/presentation.ts` builds the Presentation Mode slides.
  - `lib/activity.ts` logs client activity to `ProjectActivity`.
  - `lib/tokens.ts` makes tokens.
- **Uploads** (`lib/storage.ts` `saveFile`):
  - Storage is Cloudflare R2 if all five `R2_*` variables are set, otherwise Vercel Blob if `BLOB_READ_WRITE_TOKEN` is set, otherwise local `public/uploads/`.
  - Images are made upright, fit within 2400px, re-encoded as mozjpeg and always saved as `.jpg`.
  - `<Image>` is used with `unoptimized` throughout; keep it that way.
- **Language:** the client page is English and Arabic (`lib/client-i18n.tsx`; the English strings are the keys, with an `AR` dictionary). Every new client string needs an `AR` entry. The admin is English only.

### Team operations
The domain vocabulary, as the code defines it:
- **ProcessSection → ProcessTask:** the shared delivery process. Each task is one step of it, common to every project.
- **ProjectTaskEntry:** one cell of the project × step board, `@@unique([projectId, taskId])`. Rows are created lazily, so no row means TODO. It holds the state, an assignee override, `scheduledFor`/`dueAt`, priority, notes and `excludedFromProgress`.
- **StagePeriod:** a span of steps plus a number of days. Periods chain into derived deadlines, and a typed-in `dueAt` wins (`lib/stage-schedule.ts`, `lib/stage-deadlines.ts`).
- **ProjectSectionAssignment:** who holds a section on a project.
- **Ownership:** one rule decides who owns a cell: its assignee, else the section holder, else the step's standing owner. It lives in `lib/ownership.ts` `ownerOf`, which is mirrored in SQL by `ownedBy` (`lib/employee-tasks.ts`) and a `COALESCE` in `lib/analytics-queries.ts`. Always resolve owners through these.
- **AssignedTask:** an ad-hoc job for one person from `startDay` to `endDay`, shown on the week board (`week-board.tsx`, `week-view.tsx`; weeks start on Sunday, `lib/week.ts`).
- **TaskState:** TODO, IN_PROGRESS, SUBMITTED, DONE and TOMORROW. Employees may set only TODO and IN_PROGRESS.
- **Reviews:** an employee's photo proof creates a `TaskSubmission` and the task becomes SUBMITTED. The manager approves it (DONE) or rejects it (back to IN_PROGRESS) at `/admin/reviews`.
- **Progress:** daily counts come from `lib/daily-progress.ts` (`dayCounts`) and are used by the employee home and `/admin/analytics`. Monthly progress covers non-excluded board cells only; week jobs don't count.
- **Deductions:** progress below 90% costs 1 JOD, stored as a `SalaryAdjustment` of kind PERFORMANCE. It runs only from the Analytics button.
- **Payroll** (`lib/payroll.ts`): hourly rate = salary ÷ (26 monthly or 6 weekly) ÷ 8. Lateness is deducted, and receipts are capped at 2 JOD each.
- **Warnings** (`EmployeeWarning`): the manager gives one, with a reason, on `/admin/employees/[id]`.
  - The employee is notified at once (type `WARNING`, which preferences can't silence) and sees every warning pinned to the top of `/employee` until the manager removes it.
  - Warning `WARNING_LIMIT` (3) tells them first, then disables the account and its devices. Reopening the account is the existing Enable button.
  - Rules are in `lib/warnings.ts`, data in `lib/employee-warnings.ts`, and the admin actions in `lib/actions/warning-actions.ts`.
- **Sales targets**: a project is a sale. `Project.soldById` and `Project.soldOn` (set under Sold by / Sold on in the project's Details) say who sold it and which month it counts in — the same month window payroll uses.
  - Each employee has `monthlySalesTarget` (default `DEFAULT_SALES_TARGET`, 3), edited in their Details in the admin.
  - The employee sees the month's progress on `/employee`; the manager sees it on the employee's page and as a badge on the employees list.
  - Rules in `lib/sales.ts`, queries in `lib/sales-queries.ts`. Nothing is deducted for missing a target.
- **Days** are calendar days in the company timezone: AppSetting `timezone`, else `APP_TIMEZONE`, else `Asia/Amman` (`lib/time.ts`). `@db.Date` columns store UTC midnight of that day. Convert with `dayKeyToDate` / `dateToDayKey`.

**Pages:**
- Admin: `tasks` (the board and the week board), `reviews`, `alerts`, `analytics` (`?day=`, `?period=`), `payroll`, `employees`, `requests`, and `settings` (stage periods, push health, timezone, WhatsApp).
- Employee: `/employee` (today, or tomorrow with `?day=tomorrow`), `tasks`, `tasks/[id]`, `assigned/[id]`, `requests`, `notifications` and `profile` (push, preferences, devices, sounds, sign out).

### Chat, live updates and sounds
- **Conversations:**
  - The team group is channel key `team`.
  - A private chat between the manager and one employee is `dm:<employeeId>`.
  - URLs are `/employee/chat/team`, `/employee/chat/manager`, `/admin/chat/team` and `/admin/chat/<employeeId>`.
- **Files:**
  - `lib/chat-conversations.ts` is pure: keys, `parseConversation`, `mayOpen`, URLs.
  - `lib/chat.ts`: `getChatViewer(side)`, `channelFor` (the access check), `listMessages`, `recordChatRead`, and `conversationsFor` (one SQL query with LATERAL).
  - `lib/actions/chat-actions.ts`: `sendChatMessage`, which reads the form fields `as` and `conversation`; `markChatRead`; and `askChatAssistant`, admin only.
  - The live stream is SSE at `/api/chat/stream?as=&with=&since=`.
  - UI is in `components/chat/{chat-room,chat-header,conversation-list,assistant-panel}.tsx`.
  - Messages can be text, photos (shrunk in the browser by `lib/client-image.ts`), files or voice notes (`lib/voice.ts`). `lib/chat-sync.ts` merges optimistic and streamed messages.
- **Two sessions in one browser:** portal pages pass their own side (`chatSide`), and the stream URL carries `as=`. Without it the admin session wins.
- **Live refresh:**
  - `/api/live` is SSE that polls `liveSignature()` (`lib/realtime.ts`) every 2 s.
  - `components/live-sync.tsx` calls `router.refresh()` and dispatches `LIVE_CHANGED`. It skips conversation pages, which stream on their own.
- **Sounds:**
  - `lib/sound-cues.ts` synthesises them with Web Audio: a message is 3 rising notes, anything else is a 2-tone chime. Browsers unlock sound on the first tap, and each device can mute it.
  - `components/sound-cues.tsx` asks `/api/cues` whether there is anything new.
  - These play **only while the app is open**. A locked iPhone plays its own default sound for push notifications, and a web app can't change that. A custom lock-screen sound would need a native app using APNs, which requires a paid Apple Developer account.

### Phone frame (iOS) — read before touching layout
- **The frame:** the employee and admin shells are fixed frames sized to what is visible. `components/employee/app-viewport.tsx` writes `--app-height`, `--app-top`, `--keyboard-inset`, `--screen-shortfall` and `body[data-keyboard]`. The arithmetic is in `lib/viewport.ts` (tested); the CSS is in `globals.css` (`.employee-shell`, `.admin-shell`, `.chat-screen`, `.fills-frame`).
- **iOS 26 Home Screen app:** `visualViewport` reports about 59pt less than the screen, and **nothing fixed is drawn below it**. So the frame must never extend past `visualViewport.height`. An earlier "status bar deficit" that stretched it cut the message box in half; it was removed in `0c48679`. The measured gap is used only to trim home-indicator padding, and the page's own background shows in that strip (chat paints it the message box's grey).
- **Keyboard:** while it is up, iOS doesn't resize the page, so the frame follows the visual viewport. The tab bar hides while typing and inside conversations.
- **Diagnose with numbers, not screenshots:** five quick taps on a chat's picture switch on `components/viewport-readout.tsx`, which shows live viewport numbers on screen. Ask the owner for a screenshot with it on before guessing at a phone layout bug.

### Notifications and push
- `lib/notifications/engine.ts` `dispatchNotification` is the single entry point:
  1. Skip inactive employees.
  2. Check preferences.
  3. Write a `Notification` with a unique `dedupeKey`, so retries and repeated cron runs are safe.
  4. Send web push to every active `PushSubscription`, logging each attempt in `NotificationDelivery`.
- **Events:** task events are in `notifications/events.ts`. The manager's feed is `AdminNotification` (`lib/admin-notifications.ts`).
- **VAPID keys** (`notifications/vapid.ts`): taken from `VAPID_*` env if set, otherwise generated once and stored in AppSetting. The comments in `render.yaml` and on the settings page that say push needs them are out of date.
- **Browser side:** `lib/push-client.ts` registers `public/sw.js`, scoped to `/employee`. The service worker only shows pushes and opens their URL; it caches nothing.
  - `DeviceGuard` claims the device for whoever is signed in, and signing out releases it.
- **Cron:** `/api/cron/notifications` runs hourly.
  - 16:00 sends tomorrow's summary.
  - 08:00 sends today's summary and stage reminders.
  - Every run sends deadline reminders.
  - `?job=today|tomorrow|deadlines|stages` forces a single job.

### WhatsApp
`lib/whatsapp/index.ts` offers one send interface over two transports: Meta's Cloud API (`WHATSAPP_CLOUD_*`, preferred) or the worker (`WHATSAPP_WORKER_URL`/`_KEY`). With neither configured, the buttons open `wa.me` links.
- `lib/whatsapp/cloud-api.ts` is copied from the nexora-whatsapp library. Don't edit it here.
- The worker (`whatsapp-worker/server.mjs`, port 4100) needs a persistent disk at `/app/data`.
- Without `PUBLIC_APP_URL`, project links go out as relative paths.

### AI (Claude)
- `lib/ai/client.ts` uses model `claude-opus-5`.
- `lib/ai/assistant.ts` powers the manager's "Ask the assistant" panel in the team chat. Its answers are stored as `managerOnly` messages.
- `lib/ai/receipts.ts` reads receipt photos.
- Without `ANTHROPIC_API_KEY`, both fail softly and nothing else is affected.

### iOS app and mobile API
- `/api/mobile/{login,dashboard,projects,projects/[id],…/comments,…/cover,…/gallery}` use a Bearer token, the same one as the admin cookie. Mobile is admin only.
- The app (`ios/Sources/*.swift`) has the production URL hard-coded in `APIClient.swift`. It is unsigned and meant to be re-signed with AltStore using a free Apple ID, which also means it can't receive push notifications.

### Tests
- `npm test` runs `node --test` over `tests/**/*.test.ts` through tsx, loading `.env` and `.env.local`.
- Pure-logic tests: `analytics`, `payroll`, `progress`, `daily-progress`, `stage-schedule`, `week`, `notifications`, `devices`, `chat-*`, `group-members`, `voice`, `sound-cues`, `viewport`, `client-image`, `image-orientation`, `whatsapp`, `avatar`, `warnings`, `sales`.
- Database tests use the real local database and skip when it is unreachable: `employee-access`, `task-submissions`, `assigned-evidence`, `device-ownership`, `chat-access`, `warnings`, `sales`. A run showing `pass 0 … skipped N` with exit 0 means **the database is down**, not that the tests passed.

---

## Gotchas that have cost time

- **The local `prisma dev` database dies.** Symptoms are `P1001`, "Server has closed the connection", or DB tests cancelled en masse. Recover like this:
  1. Kill whatever listens on ports 51213–51216. In PowerShell: `Get-NetTCPConnection -LocalPort 51213 -State Listen | % { Stop-Process -Id $_.OwningProcess }`.
  2. If you see "Lock file is already being held", delete `%LOCALAPPDATA%\prisma-dev-nodejs\Data\durable-streams\neon-client-portal\server.lock.lock`. This is a marker, not your data.
  3. Run `npm run db:dev` again.
  4. `migrate status` saying "up to date" does **not** prove the database is serving; confirm with a real query.
- **Run queries one after another.** Pages that run several queries at once (`Promise.all`) fail locally with `P1017`, and production copes. Keep reads sequential; it's the codebase convention.
  - To screenshot a heavy page locally, temporarily add `max: 1` to the `Pool` in `src/lib/db.ts`, restart the dev server, and **don't commit it**.
- **Every action checks its own session.** Server actions are public endpoints, and the layout redirect isn't a security boundary. Keep queries out of `"use server"` files, because every export there becomes callable.
- **`deploymentId`** makes a page left open across a deploy reload instead of failing its server actions.
- **Git Bash on Windows** rewrites arguments that start with `/` into Windows paths. Prefix the command with `MSYS_NO_PATHCONV=1`.
- **Phone layout:** see "Phone frame". Never stretch the frame past the visual viewport, and use the readout.

## Known issues (open)

- **The project area's server actions don't check the admin session.** This covers `lib/actions/{project,gallery,drawing,document,boq,pricing,material,furniture,hotspot}-actions.ts` and the admin parts of `approval`/`comment`. Only the layout redirect guards them; the team-side actions all check. Found on 2026-09-10 and not fixed yet.
- **Arabic breaks `gallery.pdf`.** It uses the Helvetica font, which has no Arabic characters. Zip and PDF filenames also drop non-ASCII characters.
- **Deleting a project or drawing leaves some files in storage:** BOQ images and old drawing revisions.
- **Some analytics events are never logged:** `viewed_render`, `viewed_drawing`, `viewed_boq` and `viewed_pricing` come only from the seed.
- **Status checks are uneven:** `setMyTaskStatus` and `submitTaskCompletion` don't refuse SUBMITTED or DONE cells, while the week-job versions do.
- **Unused variable:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `.env.local` isn't read anywhere.

## Environment variables (names only; values are in `.env.local` and the Render dashboard)

| Variable | Used for |
|---|---|
| `DATABASE_URL` | PostgreSQL. Locally, the `postgres://` address that `prisma dev` prints |
| `SESSION_SECRET` | Signs the admin and employee cookies and the iOS token |
| `ADMIN_PASSWORD_HASH` | bcrypt hash of the single admin password |
| `R2_ACCOUNT_ID` `R2_ACCESS_KEY_ID` `R2_SECRET_ACCESS_KEY` `R2_BUCKET_NAME` `R2_PUBLIC_URL` | Cloudflare R2 uploads (all five, or none) |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob uploads, used when R2 isn't configured |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | Web push. Optional: generated and stored if absent |
| `CRON_SECRET` | The hourly notifier's key; must match the GitHub secret |
| `APP_TIMEZONE` | Company timezone (default `Asia/Amman`). The AppSetting `timezone` wins |
| `ANTHROPIC_API_KEY` | The chat assistant and receipt reading |
| `WHATSAPP_CLOUD_PHONE_NUMBER_ID` `WHATSAPP_CLOUD_ACCESS_TOKEN` `WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID` `WHATSAPP_CLOUD_APP_SECRET` | WhatsApp through Meta's Cloud API |
| `WHATSAPP_WORKER_URL` `WHATSAPP_WORKER_KEY` `WHATSAPP_LINE_ID` | WhatsApp through the worker |
| `PUBLIC_APP_URL` | Absolute links in outgoing messages |
| `RENDER_GIT_COMMIT` `RENDER_EXTERNAL_URL` | Set by Render |
