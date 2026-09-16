# NEON — the studio's platform

One Next.js app runs NEON's interior-design studio. It is live at **https://clients.neonjo.com**, served from the studio's own PC (see "Running it on the studio's PC"). Render, at `neon-client-portal.onrender.com`, was the address until the switch-over.

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
- **Confirm the deploy.** On the studio's PC a push is not a deploy: nothing there watches GitHub. Rebuild it — `docker compose --env-file .env.docker --profile public up -d --build` — then confirm with `docker ps` (neon-app `healthy`) and a real request, `curl -s -o /dev/null -w '%{http_code}' https://clients.neonjo.com/employee/login`. **There is no `?dpl=` marker there**: `deploymentId` comes from `RENDER_GIT_COMMIT`, which only Render sets, so an empty marker on `clients.neonjo.com` is normal and proves nothing either way. To check what a container is actually running, compare its image's build time (`docker image inspect`) against `git log`. On Render, where it still applies, the deploy is live when `curl -s https://neon-client-portal.onrender.com/employee/login | grep -oE 'dpl=[A-Za-z0-9]+'` matches `git rev-parse HEAD`. Then tell the owner.
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
  - `daily-notifier.yml` calls `/api/cron/notifications` every ten minutes — GitHub in practice ran it every two to five hours — with `Authorization: Bearer $CRON_SECRET`. It uses the repo secrets `APP_URL` and `CRON_SECRET`, and `CRON_SECRET` must match the site's. It has never succeeded (see Known issues); on the studio's PC `neon-scheduler` replaces it, and the workflow is disabled at the switch-over.
  - `ios-build.yml` builds an unsigned IPA whenever `ios/**` changes.

---

## Running it on the studio's PC (Docker)

`clients.neonjo.com` is served from the studio's own PC, entirely in Docker. Render keeps running the same code at its own address until the switch-over is finished.

| Container | What it is |
|---|---|
| `neon-db` | PostgreSQL 17, the same major version as the Neon database it replaces. Data on the `neon_db-data` volume. Reachable from this PC only, at `127.0.0.1:55432`. |
| `neon-app` | The site, built by `Dockerfile`. On start it applies migrations and serves, as Render does. Also on `127.0.0.1:3011`, this PC only, for testing. |
| `neon-tunnel` | `cloudflared` running the `neon-portal` tunnel: `clients.neonjo.com` → `neon-app`. Config in `deploy/cloudflared/config.yml`; its secret credentials stay in `%USERPROFILE%\.cloudflared\`. |
| `neon-scheduler` | Calls the notification jobs on `neon-app` every ten minutes (`curlimages/curl`), with only `CRON_SECRET`. Behind `--profile live`: off until this PC is the real site, because before that it would notify the team from a copy they are not working on. `docker logs neon-scheduler` shows one line per run. |
| `neon-whatsapp` | The WhatsApp worker, in its own project (`whatsapp-worker/`) because it holds a linked session. The site reaches it at `host.docker.internal:4100`. |

```
docker compose --env-file .env.docker up -d --build            # site + database
docker compose --env-file .env.docker --profile public up -d   # ...and the tunnel
docker compose --env-file .env.docker --profile public --profile live up -d   # ...and the scheduler, once this PC is the real site
```

- **`--env-file .env.docker` is required.** It holds the database password and the site's secrets (git-ignored, generated from `.env.local`). Without it Compose refuses to start rather than starting wrong.
- **Everything restarts by itself** (`restart: unless-stopped`), and Docker Desktop starts at sign-in — so after a reboot the site is back once Windows is signed in.
- **The tunnel sits behind `--profile public`**, so a plain `up` never puts anything on the internet, and **the scheduler behind `--profile live`**, so nothing notifies anybody until the switch-over.
- **`.env.local` still points at the development database, on purpose.** `npm run dev` and the tests must never touch the database clients use. With the development database stopped, the `*.db.test.ts` files skip — that is the right outcome, not a failure.
- **Backups:** `scripts/backup-docker-db.ps1`, run daily by the scheduled task *NEON database backup*, writes a complete copy to `local-backup\docker\` and keeps 14 days; `local-backup\docker\backup.log` records each run. The copies sit on the same disk as the database, so keep one somewhere else too.
- **Loading a copy of the live data into it:** create the tables with migrations run from this PC through a Prisma config that loads **no** env files — the project's `prisma.config.ts` lets `.env.local` override `DATABASE_URL`, which would aim them at the development database. Confirm `prisma migrate status` reports `127.0.0.1:55432` before `migrate deploy`, then run `scripts/restore-local-data.mjs <copy>` with `DATABASE_URL` set to the Docker database and no `--env-file`.

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
scripts/              restore-local-data.mjs, backup-docker-db.ps1 (daily backup of the Docker database)
ios/                  NeonAdmin SwiftUI app (XcodeGen spec in ios/project.yml; no .xcodeproj committed)
whatsapp-worker/      standalone WhatsApp Web service (its own Dockerfile; not in render.yaml)
Dockerfile            the site as a container (see "Running it on the studio's PC")
docker-compose.yml    the site, its PostgreSQL and the tunnel on the studio's PC
deploy/cloudflared/   the tunnel's config inside Docker (no secrets)
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
- **Employees put things on projects too** (`/employee/projects`, `lib/actions/employee-project-actions.ts`): drawings, documents, and photos into a room of the gallery. A Projects tab in the portal lists every non-archived project; tapping one gives what is on it and the forms to add more.
  - **Two decisions the studio made, written here because the code cannot explain itself:** an employee's upload reaches the client **immediately**, with nobody in between; and **anybody on the team** may add to any project, not only whoever holds a section of it. Both were asked and answered rather than assumed.
  - **Adding only — nothing there deletes.** Removing a drawing also removes the file from storage and takes it off the client's page for good, and an accidental tap on a phone should not be able to do that. Deletion stays with the manager.
  - **The admin actions were not loosened to make this work.** They still require an admin session; these are separate actions behind `requireEmployee`. Opening one of the existing ones would not have meant "employees too", it would have meant anybody at all — which is the hole that was closed the same day.
  - **Photos upload one per request, compressed in the browser first.** The request body limit applies to the *raw* upload, before any compression, so a handful of camera photos sent together is refused however small they end up. `components/employee/project-photo-upload.tsx` loops; `addProjectImage` takes one file. The admin's own uploader learned this first and its comment says so.
  - The manager is told after the fact — not a gate, since the studio chose immediate, but it means an upload is learned from the platform rather than from the client. Photos are keyed on the room and the day, so eight from one site visit arrive as one notification.
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
- **Task detail and dependencies**: a board cell (and a week job) can carry what to hand in (`deliverable`), what counts as done (`acceptance`), the hours it should take (`estimateHours`), why it cannot move (`blockedReason` + `blockedById`), and where it stands (`lastUpdateNote`, `lastUpdateAt`, `nextStep`). `TaskDependency` rows say which cell waits for which.
  - **"(and a week job)" was true of the schema and false of the product until now.** `AssignedTask` has carried `deliverable` and `acceptance` from the start, but nothing ever wrote them: the dialog on the week board had no field, `readForm` did not read them, and `assigned-tasks.ts` did not select them. So every photo sent for a hand-assigned job came back from the review queue saying *"Nothing is written under 'Counts as done when' for this task, so there was nothing to check it against"* — not occasionally, but always and by construction. The column existed and was unreachable, which reads in the code as a feature and behaves as a missing one.
  - A step's standard covers board cells (`lib/task-types.ts`), and a job handed out by hand has no step behind it — so its acceptance is written on the job itself, in the same dialog that hands it out. The employee sees it above the camera, one line per item, because each line is checked on its own.
  - **None of it is a new state.** Ready, blocked, waiting on something, waiting for approval are all read off those facts by `readinessOf` in `lib/task-readiness.ts`, so the board keeps its five states and a task turns ready the moment the one before it finishes — nothing to remember to update.
  - The manager fills the detail in the cell editor, **Waits for** included: a list of the other steps this one waits on. A list that would leave two tasks waiting on each other is refused whole, never half-saved (`lib/task-graph.ts`), and a cell being waited for gets its row created so the link has something to point at. The employee sees all of it on `/employee/tasks/[id]`.
- **What each kind of work needs** (`lib/task-types.ts`, pure and tested; filled in on `/admin/settings` under "What each kind of work needs", `components/admin/task-type-library.tsx`) is the standard for a step, written once instead of on every project: what is handed in, what counts as finished, the proof to send, the checklist to follow, the hours, and who reviews it. It lives on `ProcessTask`, and a cell of the board keeps the right to differ — the same shape as ownership, where the step carries the standing answer and the cell carries the exception.
  - **The cell wins where it has words of its own; the step fills the rest** (`effectiveDetail`). Every answer carries `from: "cell" | "step" | null`, so a screen never shows an inherited value as though somebody typed it there.
  - **An emptied box is not an override.** Clearing a cell's acceptance inherits the step's again rather than turning the check off for that cell — a test pins it, because the opposite is what a blank-means-none reading would quietly do.
  - `linesOf` is the single reading of a written list — the criteria a submission is checked against, the checklist, the proof — so the number the manager sees counted on the step is the number that actually gets checked. `lib/ai/verify-submission.ts` reads through it and falls back to the step, which is what turns "nobody wrote what done means" into a check that runs at all.
  - **Auto-accept is refused when nothing is written to check against** (`mayAutoAccept`), however the switch is set; and what is handed in does not count as a criterion, because it says what to send rather than what makes it right. A week-board job has no step behind it and so never qualifies. This is the one setting in the system that could quietly accept every claim for ever, so the guard lives in the pure module with a test that runs it through `outcomeOf` rather than trusting the function alone.
  - **The person doing the work sees it too.** `/employee/tasks/[id]` reads through `effectiveDetail`, so a cell nobody customised still says what finishing means. Acceptance is listed one line per item rather than as a block of prose, because each line is checked on its own when the photo arrives. The checklist is a reminder with nothing to tick — a box that gets ticked is a claim, and a claim here has exactly one route, the photo — and **what proof to send sits above the camera** in `components/employee/completion-form.tsx`, since telling somebody what to photograph after they have photographed something is advice that arrived too late. `taskSelect` in `lib/employee-tasks.ts` carries the step's standard beside the cell's own words.
- **Days** are calendar days in the company timezone: AppSetting `timezone`, else `APP_TIMEZONE`, else `Asia/Amman` (`lib/time.ts`). `@db.Date` columns store UTC midnight of that day. Convert with `dayKeyToDate` / `dateToDayKey`.
- **The employee's own day** (`lib/now-next.ts`, pure and tested; fetched by `lib/now-next-queries.ts`, shown by `components/employee/now-next-card.tsx` at the top of `/employee`) answers three questions and no more: what now, what it is for, what next — plus how much of the working day is left.
  - Only a plan that was actually **published** counts (`appliedAt`). A draft nobody put on the day is not something to tell somebody they are late for.
  - Being on a break and having a block running are separate facts: a block that runs through lunch is still the block somebody is on, and the break is said as well, not instead.
  - It never implies idleness — an empty day says "Nothing planned for today", and outside working hours it says the hours.
- **The manager's day** (`lib/day-board.ts`, pure and tested; gathered by `lib/day-board-queries.ts`, shown by `components/admin/day-board-list.tsx` at the top of `/admin`) turns the day's facts into the judgements a manager acts on.
  - Ordered by what can actually be done something about: work stuck on somebody else, then a claim that does not match the board ("said started, still pending"), then answers waiting on the manager, then a day with more planned than it holds, then a day with no plan at all — and last, silence.
  - **Silence is never a verdict.** An unanswered question is counted and shown as an unanswered question; nothing on this screen says anybody did nothing, because the data cannot tell the difference between "did not work" and "did not reply".
  - Capacity comes from the working day, and for today it is what is *left* of it, so a board opened at four in the afternoon does not call everybody overloaded.
  - The gatherer reads one person at a time on purpose: it runs several queries each, and firing them all at once is what the local database falls over on.
- **How the work is going** (`lib/performance.ts`, pure and tested; gathered by `lib/performance-queries.ts`, shown by `components/admin/performance-card.tsx` on `/admin/employees/[id]`) is five numbers over the last 30 days: what landed by the date it was given, what was accepted first time, how often work came back, how long it sat waiting on somebody else, and how close the estimates were.
  - **Every one of them is about the output.** Presence, hours at a desk, reply speed and click counts are deliberately absent and must stay absent — a number that stands in for the work is worse than no number.
  - **A figure is refused rather than guessed.** Below `MIN_SAMPLE` (3) an indicator returns `{value: null, sample, why}` and the card prints the reason instead, so one late task can never read as "0% on time". Work with no deadline is left out of the on-time figure rather than counted as met; waiting time is reported from the very first measurement, because it is a fact about the studio and not a judgement of a person; and estimate accuracy is a **median**, so one afternoon that went badly does not define somebody's estimating.
  - **The facts are recorded events, never inferences:** `TaskStateChange` for when work was started and when it landed, `TaskSubmission` for what the review made of it, and a `blocked` answer on `ScheduledFollowUp` for waiting — measured to the next thing that happened to that task, or to now if it is still stuck. Work finished, reopened and finished again is one piece of work, counted by the time it finally landed.
  - **Whose work it is comes from `ownedBy`, never from a filter written out again here.** Each of its branches requires the cell to have no assignee; a hand-written `OR` of "assigned to them or their step" instead counts a cell the manager gave to somebody else in the step owner's numbers. `tests/performance.db.test.ts` exists for that one case, and week-board jobs are counted alongside board cells because that is where a planned day's blocks land.
- **Checking a claim of finished work** (`lib/verification.ts`, pure and tested) turns per-criterion verdicts into one decision. Each criterion carries what was asked, what in the evidence speaks to it, a verdict, and the gap.
  - Five verdicts, and the distinction that matters: **`cannot-tell` is not `not-met`**. "The photo does not show whether it was sent" and "it was not sent" must never produce the same message to a person — one asks a question, the other asks for work.
  - Precedence: anything needing a person wins; then a definite gap (it can be acted on); then an unsettled one; and only then, everything shown.
  - **Nothing is ever accepted on no criteria at all** — "there was nothing to check" is not "it passed" — and acceptance without a person is a policy switch that is off by default.
  - `stillOpen` carries forward only what a re-submission has not settled, so nobody is asked twice for the same thing.
  - `submissionClosesTask()` returns false and always will: sending work is the beginning of a check, not the end of one.
  - **Where it is kept:** `SubmissionCheck` is one row per criterion per submission — what was asked, what the evidence showed, the verdict, the gap — and `TaskSubmission` gained `outcome` and `checkedAt`. The criteria are copied onto the rows rather than read live, so changing a task's acceptance text later cannot silently change what somebody was judged against.
  - **The manager sees the reasoning, not a verdict to trust.** `/admin/reviews` shows each criterion above the approve/send-back buttons (`components/admin/submission-checks.tsx`): what was asked, what the photo showed, and the gap. "Not done" is red and "the evidence does not show it" is grey with a question mark — giving them the same weight on screen would undo in a glance what the rules are careful about. A submission nothing has checked says so, rather than showing an empty box that could be read as "nothing wrong".
  - `lib/ai/verify-submission.ts` does the looking. It ends at "waiting for the manager" on every path where it cannot honestly judge — no criteria written, no `ANTHROPIC_API_KEY`, a photo stored locally that the model cannot fetch, or an answer it cannot read — and none of those is a refusal of the work. It never writes a task's state.
- **Who may move a task where** (`lib/task-transitions.ts`, pure and tested). The board's five states already say what the studio needs — TODO is pending, SUBMITTED is with the manager for review, DONE is approved — so nothing new was invented; the rules between them are simply written down in one place instead of being inferred from six scattered actions.
  - An employee starts and un-starts work, and reaches review **by sending proof**, never by choosing the state. They can never write DONE, and cannot touch work that is already submitted or approved.
  - The manager approves, reopens, sends back for changes and schedules — but never puts somebody else's work into review on their behalf.
  - **Automation moves nothing.** A planned block ending is not evidence that anything happened, so `canMove(..., "system")` refuses every transition. Jobs ask; people decide.
  - `TaskStateChange` records every move: from, to, who, why, and whether it was automatic. Until it there was no record at all — a tick on the board left nothing behind, so "when did this actually start" had no answer anywhere.
  - `lib/task-state-log.ts` `recordStateChange` is the single choke point, and **all six places that write a state now call it**: the manager's tick (`task-actions.ts`), the employee's status control (`employee-actions.ts`), sending proof and the review that settles it (`submission-actions.ts`), and both sides of a week-board job (`my-assigned-actions.ts`, `assigned-task-actions.ts`). It never throws into its caller — a change that happened must not be undone because the note about it could not be written.
  - **Those six sites ask `canMove` rather than keeping their own copies of the rules.** A move that changes nothing returns quietly instead of throwing — the board cycles states and lands on the same one often enough that an error there would be wrong. The board keeps its own smaller vocabulary (`VALID_STATES`: TODO, DONE, TOMORROW) for what a tick may cycle through; `canMove` then decides whether that particular move is legal.
- **The follow-up queue** is the first scheduled work in the platform: before it there was no queue, no job table and nothing that could act at a particular minute — only the hourly cron over deadlines.
  - `ScheduledFollowUp` is one row per question owed (who, which day, which block, what it is about, when it is due). `lib/follow-up-queue.ts` writes them (`scheduleFollowUps`, called at the end of `applyDayPlan`, so putting a day on the board is what queues its questions), finds what is due, and records answers.
  - `lib/notifications/follow-up-events.ts` `runFollowUps` sends what has come due, through the same `dispatchNotification` as everything else. It re-reads the world first: a task already submitted or done has its question closed as skipped (`skippedAt`, with `skippedBecause`) rather than chased — never marked asked, because the day board counts an asked question without an answer as unanswered, and nobody received it.
  - **A question is only ever asked on its own day.** `firstAskableDay` (`lib/follow-ups.ts`) is today in the company's timezone, and `dueFollowUps` never picks anything older — so a scheduler that was down overnight does not wake up to a morning of questions about yesterday. An expired question is left **unasked**, never stamped: the day board counts `askedAt` without `answeredAt` as unanswered, and a question nobody received must not read as one somebody ignored.
  - It hangs off the existing cron endpoint (`?job=followups` forces it), and `daily-notifier.yml` now runs **every ten minutes** rather than hourly — a question due at 11:30 is worth little at 12:05. Every daily job inside the endpoint stays once-a-day because each is keyed to the day it is about.
  - **Asking once is the unique index, not a check.** `followUpKey` is derived from who/which day/which block/what time, `ScheduledFollowUp.dedupeKey` is unique, and the same key is the notification's dedupe key — so publishing a plan twice, or two overlapping polls, still asks once. `askedAt` is stamped even when delivery fails, so nothing re-sends for ever.
  - **The answer is given on the page, not in the notification.** iOS does not draw action buttons on a web push at all, so a reply that lived only there would not exist on half the studio's phones. The notification opens the task; `components/employee/follow-up-reply.tsx` puts the choices at the top of it — Started / Need information / Blocked / Needs more time, and at the end of a block Done / Partly / Blocked / Not started — and `lib/actions/follow-up-actions.ts` records them.
  - "Started" moves the task to IN_PROGRESS, but only from TODO: an employee's answer never overwrites the manager's state. "Blocked" is kept as the employee's answer and the manager is told — it does not write `blockedReason`, which is the manager's own record. An answer is evidence for a decision, not the decision.
- **Rules the studio sets for itself** (`lib/automation.ts`, pure and tested; run by `lib/notifications/automation-events.ts` on the same cron pass as the follow-ups; edited on `/admin/settings` under "Rules that watch the day"). Each rule watches one condition — no plan, more planned than the day holds, work stuck on somebody else, said-started-still-pending, an answer waiting on the manager, unanswered questions — and asks, tells, or escalates.
  - **A rule can only ever speak.** There is no action that moves, ticks, approves or reassigns anything: `mayMoveWork()` says so in one place, and `canMove(..., "system")` refuses every transition underneath it regardless. The worst a misconfigured rule can do is talk too much.
  - **The conditions are read off `PersonDay`, never derived again.** `countFor` maps each trigger onto the facts the manager's day board is already drawn from, so "more planned than the day holds" means exactly one thing in this codebase and changing it changes both at once.
  - **Three things keep it from becoming noise:** a grace (how long the condition must have held before anything is said), a cooldown (how long before the same rule speaks about the same person again), and a studio-wide switch that beats every individual rule. Grace and cooldown are measured from moments recorded in `AutomationState` when they happened — never from the clock — so a runner that fires twice in a minute and one that wakes an hour late behave the same.
  - **Escalation redirects rather than duplicates:** past `escalateAfterMinutes` the same firing goes to the manager *instead of* the person, and earns its own dedupe key because it is a different thing to say to a different person.
  - **It ships switched off, and every new rule is off too.** `/admin/settings?preview=rules` runs the whole engine against today and writes nothing at all — no state, no notification — so what a rule would have done can be read before it is ever turned on. That preview is the only honest way to introduce something that talks to people by itself.
  - The wording lives in the runner rather than being typed by the manager, because the wording is where this could do harm. Every message states a fact and asks a question; the unanswered one says "has N unanswered questions" and never that anybody did nothing — the data cannot tell "did not work" from "did not reply", and the day board is built on the same refusal.
- **The day in the employee's own words** (`DailyReport`; written on `/employee/requests` under "Today's report", saved by `saveDailyReport` in `lib/actions/operations-actions.ts`, read on `/admin/requests`). Everything else the platform holds about a day is inferred — a state that moved, a question answered with a tap, a photo checked against criteria. This is the one part that can only come from the person who was there, including whatever no column has a place for.
  - **One row per person per day** (`@@unique([employeeId, day])`): writing again during the day edits the same report rather than adding another note, so the manager reads one account of Tuesday instead of seven fragments of it. Nothing locks after sending — somebody remembering at six what they did at eleven should be able to add it.
  - **The manager is told once a day per person, not once per edit**, keyed on the person and the day. A report still being written must not buzz a phone every time a sentence lands.
  - **"Hasn't written today's report yet" is said as exactly that.** The data cannot tell a quiet day from an unwritten one, and the screen must never phrase it as though it can — the same refusal the day board is built on.
  - One box and nothing else, deliberately. Fields would turn an account of a day into a form to satisfy, and the platform already has plenty of structured signals about a day; what it lacked was prose.
- **Following a day up** (`lib/follow-ups.ts`, pure and tested) decides *when* somebody is asked about their day, never how or whether to send: the day's start, each planned block's start, a check part-way through a block of 90 minutes or more, each block's end, and the day's end.
  - Every time it produces has been through the working day first, so nothing lands in lunch or after hours. A question about something finishing is clamped to the end of the day rather than pushed into tomorrow, because asking tomorrow morning is asking too late.
  - `followUpKey` is the dedupe key, derived from who/which day/which block/what time and never from the clock — so the poller is safe to run as often as we like, and a block that moves earns a new question.
  - Blocks that were never ticked onto the day produce nothing.
- **The working day** (`lib/work-hours.ts`, pure and tested) is the one place that knows when work happens: which weekdays are worked, the start and end, lunch, and a margin deliberately left unplanned. The manager edits it in Settings under "The working day"; it is stored as the `work_*` AppSetting keys and read in a single query by `getWorkHours()` (`lib/settings.ts`).
  - `capacityMinutes` is what a plan may fill — 11:00 to 19:00 with a half-hour lunch is **450 minutes**. `remainingMinutes` is what is left when a day is already running, so planning at 14:00 cannot propose a whole day. `nextWorkingDay` skips days nobody works, and `nextWorkingMoment` pushes a follow-up out of lunch and out of the evening.
  - Everything that plans, chases or shows a time must read it rather than hard-coding hours, so changing the hours moves all of them together.
  - **Two traps its tests exist for:** `Number("")` and `Number(null)` are both `0`, and `0` is a valid weekday and a valid number of minutes. An unset setting therefore reads as "Sundays only" or "no lunch at all" unless it is checked for being present first — both shipped as real bugs before the tests caught them.

**Pages:**
- Admin: `tasks` (the board and the week board), `reviews`, `alerts`, `analytics` (`?day=`, `?period=`), `payroll`, `employees`, `requests`, and `settings` (process sections, stage periods, what each kind of work needs, the working day, how a day is planned, push health, timezone, WhatsApp).
- Employee: `/employee` (today, or tomorrow with `?day=tomorrow`), `tasks`, `tasks/[id]`, `assigned/[id]`, `projects`, `projects/[id]`, `requests`, `notifications` and `profile` (push, preferences, devices, sounds, sign out). The tab bar carries six of them — it said five for a long time, and Projects was added deliberately rather than drifted into.

### Chat, live updates and sounds
- **Conversations:**
  - The team group is channel key `team`.
  - A private chat between the manager and one employee is `dm:<employeeId>`.
  - A private chat between two employees is `pair:<id>:<id>`, the two ids sorted so each pair has exactly one. **The manager is not in it and cannot open it** — a decision, not an omission: it is absent from the manager's list, badges and sounds, and `mayOpen` refuses it. It is created only while both are active; once it exists it stays readable after one of them leaves.
  - URLs are `/employee/chat/team`, `/employee/chat/manager`, `/employee/chat/<colleagueId>`, `/admin/chat/team` and `/admin/chat/<employeeId>`. The same id means a different conversation on each side: on the employee side it is always a chat the employee is in.
- **Files:**
  - `lib/chat-conversations.ts` is pure: keys, `parseConversation`, `mayOpen`, URLs.
  - `lib/chat.ts`: `getChatViewer(side)`, `channelFor` (the access check), `listMessages`, `recordChatRead`, and `conversationsFor` (one SQL query with LATERAL).
  - `lib/actions/chat-actions.ts`: `sendChatMessage`, which reads the form fields `as` and `conversation`; `markChatRead`; and `askChatAssistant`, admin only.
  - The live stream is SSE at `/api/chat/stream?as=&with=&since=`.
  - UI is in `components/chat/{chat-room,chat-header,conversation-list,assistant-panel}.tsx`.
  - Messages can be text, photos (shrunk in the browser by `lib/client-image.ts`), files or voice notes (`lib/voice.ts`). `lib/chat-sync.ts` merges optimistic and streamed messages.
- **Task cards** — the manager hands out work from the team's group or a private chat with + → Task, or by typing `/task …`:
  - **Not a new kind of work.** A `ChatTask` is the card (title, description, `dueAt` as an exact moment, priority, optional attachment); each person on it gets an ordinary `AssignedTask` with `chatTaskId` set, running from today to the due day. So the week board, the employee's own list, photo proof, `/admin/reviews`, `TaskStateChange` and the notifications all work on it unchanged, and **the card calls the same actions** (`setMyAssignedTaskStatus`, `submitAssignedTaskCompletion`, `setAssignedTaskState`, `approveSubmission`, `rejectSubmission`) rather than having its own. States on a card read To do → In progress → Sent for review → Done; Done still comes only from the manager.
  - The message is `kind: TASK` with the title as its `body` (so the chat list and lock screens say what it is), and `messageSelect` carries the card. Deleting the message deletes the card, every part and the thread (`onDelete: Cascade` all the way down). The message, card and parts are written in one transaction (`lib/chat-task-store.ts` `createChatTaskRecords`).
  - Rules are pure in `lib/chat-tasks.ts`: `/task` parsing, who may create (the manager, never in a chat between two employees) and comment (the manager and the people on it), `readAssignees` (refused whole if anybody is outside the chat), `readDue`, `defaultDue` (end of today's working day while an hour is left, else the next working day's), `overallState`, `isOverdue`, and the Tasks list order.
  - Live: the chat stream also sends `tasks` — every card id plus the newest 100 in full — whenever `taskSignature` moves (a part's state, a pending photo, a comment, a card added or deleted). A card missing from the ids is taken off screen unless it is newer than the snapshot's `at`.
  - The thread under a card is `ChatTaskComment`. Notifications: `TASK_ASSIGNED` to each person on create, `TASK_UPDATED` for comments and deletion, an `AdminNotification` for an employee's comment; all link to `/…/chat/<slug>?task=<id>`, which opens the chat scrolled to the card.
  - UI: `components/chat/{task-card,task-sheet,task-list,chat-sidebar,person-avatar}.tsx`. The chat list pages have Chats and Tasks tabs (`?view=tasks`); the admin conversation page has them in its side panel.
- **Meetings** — the manager sets one from the team's group or a private chat with + → Meeting, or by typing `/meet …`:
  - **The third card in a chat, built exactly like the first.** A `ChatMessage` of `kind: MEETING` whose `body` is the title (so the chat list and a lock screen can say what it is), joined 1:1 to a `ChatMeeting` by `messageId String @unique … onDelete: Cascade`, with one `ChatMeetingAttendee` per person asked. Written in one `prisma.$transaction`; calling it off deletes the *message* and the cascade takes the rest. Rules are pure in `lib/chat-meetings.ts` (unit-tested), the database side is `lib/chat-meeting-store.ts` (deliberately not `"use server"`), the sessions and notifications are `lib/actions/chat-meeting-actions.ts`.
  - **Attendees are keyed, not related**: `memberKey` is `"admin"` for the manager — who has no `Employee` row — and the employee id otherwise, the same shape `CallParticipant` and `ChatRead.readerKey` use. That is what lets the manager be in the room.
  - **A meeting holds no call, on purpose.** `startCall` needs a `ChatViewer` from a session cookie, and a call created by a scheduled job with no browser behind it is swept as missed within `STALE_MS` (20 s) — it would write "Missed call" into the chat every time. So the card carries a Join button that opens ten minutes before the hour: whoever presses first *starts* the call and everybody after them joins it, because `startCall` reuses any non-ENDED call on that channel. Nothing server-side ever opens one.
  - **Two moments are announced**, `remindMinutes` before (0 means only at the time) and at the start, by `lib/notifications/meeting-events.ts` `runMeetingReminders` on the `?job=meetings` pass. There is **no queue table**: the notification's own unique `dedupeKey` carries the meeting's `startsAt`, so a pass that runs twice or wakes late tells nobody twice, and a moved meeting earns a new key. Somebody who answered "not coming" is not chased.
  - **A second scheduler runs it every minute.** `neon-meeting-scheduler` in `docker-compose.yml` (behind `--profile live`, like the other) calls only `?job=meetings`; the ten-minute pass is left alone because it carries the rules engine and the deadline sweep, and a meeting at 2:30 announced at 2:38 is worth very little.
  - Live like a task card: `meetingSignature`/`meetingSnapshot` drive a third SSE event, `meetings`, so an answer reaches every open chat without a new message. `?meeting=<id>` opens the chat scrolled to the card.
  - **The card wears the task card's palette, not the studio's**, because `meeting-card.tsx` and `meeting-sheet.tsx` are rendered by both portals — the manager and the person on a phone must be looking at the same card. Nothing in them may use a warm token.
  - UI: `components/chat/{meeting-card,meeting-sheet}.tsx`. Silence is never read as a refusal anywhere: `INVITED` means asked and not yet answered, and the card and the copy both say exactly that.
- **Calls** — audio and video, from the phone and camera buttons in any conversation's header: the team's group, where a call rings everybody and carries on while anybody is in it, and the private chats (`mayCallIn` in `lib/calls.ts`):
  - **The server only introduces the devices.** Sound and pictures go straight between them over WebRTC, one connection per pair; the database holds who was asked and who is in (`Call`, `CallParticipant`) and the messages two devices trade to connect (`CallSignal`, deleted when the call ends). Rules are pure in `lib/calls.ts`; the database side is `lib/call-store.ts`.
  - **Route handlers, not server actions**: `POST /api/calls` (start, join, decline, leave, heartbeat), `POST /api/calls/signal`, and `GET /api/calls/stream?as=` (SSE: `ready` with the ICE servers, `calls`, and `signals` carrying their id so a reconnect resumes through Last-Event-ID). A page runs its server actions one at a time, which would hold a call's connection up behind anything else, and a closing tab can only say it is leaving with `sendBeacon`. Route handlers get no origin check of their own, so every POST calls `sameOrigin` (`lib/request-origin.ts`).
  - **In the browser** (`components/calls/`): `call-provider` is mounted in both shells, so a call rings on any page and survives moving between pages; `call-session` owns the microphone, camera and screen, the connections (perfect negotiation, a transceiver per role so the camera toggles without renegotiating, a data channel for muted/camera/sharing state, ICE restart on a dropped connection), speaking levels and connection quality; `pre-join`, `incoming-call`, `call-screen` (grid, speaker view, screen share, people and chat panels, the draggable minimised window) and `call-buttons` are the screens.
  - **How a call ends** is `sweepCall`: ringing, it is missed after `RING_MS` (45 s) or when the caller has gone, and declined when everybody asked said no; running, a call between two people ends when either leaves, a group call when nobody is left. An open call beats every 5 s; somebody silent for `STALE_MS` (20 s) counts as gone, and a device the server dropped joins again on its next beat. Any open calls stream tidies stale calls every few seconds. Each call leaves a `CALL` message in the chat — "Missed call", "Declined call", "Call ended · 4:32" — drawn as a line across the conversation.
  - **ICE**: Cloudflare's STUN always; Cloudflare TURN when `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_API_TOKEN` are set (`lib/ice-servers.ts`, credentials cached for a day, port 53 addresses dropped because browsers block them). Without TURN, a call cannot connect on networks that forbid direct connections — some mobile carriers, strict office firewalls.
  - **Limits**: with the app closed a phone gets only the ordinary "Incoming call" notification, and an iPhone Home Screen app drops a call when it goes to the background.
- **Two sessions in one browser:** portal pages pass their own side (`chatSide`), and the stream URL carries `as=`. Without it the admin session wins.
- **Live refresh:**
  - `/api/live` is SSE that polls `liveSignature()` (`lib/realtime.ts`) every 2 s.
  - `components/live-sync.tsx` calls `router.refresh()` and dispatches `LIVE_CHANGED`. It skips conversation pages, which stream on their own.
  - **A deploy asks everybody to reload.** The heartbeat's `ready` event carries `appVersion()` (`lib/app-version.ts`), and `LiveSync` is given the build its own page was drawn by — the admin through `AdminShell`, the employee portal straight from its layout. A deploy replaces the server, so every open heartbeat drops and the browser reconnects **to the new build**; the first word it hears is a version that no longer matches, and `components/update-required.tsx` blocks the page with "A new version is ready", reloading by itself after 30 seconds for a phone left on a bench.
    - **The version is Next's own `.next/BUILD_ID`**, deliberately: it changes on every build and *not* when a container merely restarts after a crash or a reboot, so nobody is interrupted for nothing. It needs no build argument and no commit passed in at deploy time — a habit like that is one you forget, and forgetting it would leave the prompt silently switched off. `RENDER_GIT_COMMIT` still wins where it is set; in development the version is the constant `"development"`, so working on the platform never nags you.
    - Blocking is the point, not rudeness: a page from the previous build talks to a server that is gone, and `deploymentId` — which is what would otherwise make Next reload it — is **unset on the studio's PC**, because it comes from `RENDER_GIT_COMMIT`. That is also why `?dpl=` is empty there.
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
- `lib/whatsapp/cloud-api.ts` is copied from the nexora-whatsapp library. Don't edit it here. Both transports are that library's — the Cloud one is a module inside it, not something reached for outside the studio's own stack.
- **The worker is the studio's own service**, in `whatsapp-worker/`: its own key, its own session, its own disk, its own container. It is separate from the portal because a session needs a browser, a process that stays up and a disk that survives a restart, and Render's Node runtime has none of the three — not because it belongs to anything else. `whatsapp-worker/docker-compose.yml` runs it anywhere Docker runs.
- **The portal states its own `kind`.** Every send-text carries `kind: "notification"`. The library's classes are `reply`, `notification` and `cold`, and `cold` is capped at 20 new recipients per number per day because first contact is what gets a number restricted. The caller is the only side that knows what a message actually is, so it says so rather than letting the worker guess. A test pins it.
- **An absent `idempotencyKey` is passed on as absent.** The library then derives one from line + recipient + text and suppresses an identical message for five minutes, which is what collapses a retried POST or a second tap while the first send is still pacing. `server.mjs` used to substitute `portal:<phone>:<Date.now()>`, which looks like a sensible default and is the opposite of one: a key carrying the clock is unique every call, matches nothing, and turns the deduplication off exactly where it was designed to work.
- The worker (`whatsapp-worker/server.mjs`, port 4100) needs a persistent disk at `/app/data`.
- Without `PUBLIC_APP_URL`, project links go out as relative paths.

### AI (Claude)
- `lib/ai/client.ts` uses model `claude-opus-5`.
- `lib/ai/assistant.ts` powers the manager's "Ask the assistant" panel in the team chat. Its answers are stored as `managerOnly` messages.
- `lib/ai/receipts.ts` reads receipt photos.
- `lib/ai/day-plan.ts` proposes one person's day, from the card on `/admin/employees/[id]`. It reads `Employee.playbook` ("What they usually do", on that page), the AppSetting `planning_notes` ("How we plan a day", in Settings) and their open board work with its readiness, then asks for a timetable.
  - **The working day bounds it, not the prompt.** The brief carries the real hours, the lunch it may not plan across, and the number of minutes it may fill — the day's capacity, or only what is left when planning a day that has already started (`remainingMinutes`). The prompt names no hours of its own; a test asserts that, because the hard-coded "9:00 to 18:00" it used to carry silently overrode Settings. "Tomorrow" on the card is `nextWorkingDay` and is shown as a date, so nobody plans a day the studio is closed.
  - **The person's profile is the rest of what it plans from**, all of it on `/admin/employees/[id]`: what they usually do, what they can do, work of theirs worth copying, who their finished work goes to, and how many minutes of real work their day holds.
    - Everything except the playbook is **left out of the brief when empty** rather than padded. Only two lines in the whole brief say "nothing written down yet" — how this person is worked, and how the studio plans — because those are the two a proposal cannot honestly be judged without; a third would bury them. A test counts those two occurrences, so adding a field that pads is caught.
    - `capacityFor` lets a person's own figure **lower** the studio's day and never raise it past what the day actually holds. An empty or zero box means "no answer", not "no minutes" — read literally, a typed zero would propose an empty day for ever.
    - **Nobody reviews their own work:** the select does not offer it, and `updateEmployeeAccount` clears it anyway, because a rule only hidden in a dropdown is a rule waiting to be worked around.
  - The brief reads each task through `effectiveDetail` too, so a cell that says nothing of its own still hands over the step's deliverable, acceptance and hours instead of telling the planner there are none.
  - **Every task is handed over with a code** (`T1`, `T2` …) and the model puts that code on the block it plans. That is what ties a sentence to a board cell, and so what makes the plan actionable rather than readable. `lib/day-plan.ts` is the pure half — the brief, the codes, and reading the timetable back — and is unit-tested.
  - **The plan is stored**, not held on a screen: `DayPlan`, one row per person per day, blocks as JSON (`lib/day-plan-store.ts`). A proposal that vanished when the manager went to look at the board was useless, because looking at the board is what they do before deciding.
  - `lib/actions/day-plan-actions.ts` does the three moves: generate, save the manager's edits (which blocks stay, and at what times), and apply. Applying sets only `scheduledFor` and `dueAt` on the ticked blocks — notes, priority and the rest of the cell are the manager's — and notifies through the same engine as every other change. The blocks come from what was saved, never from the browser, and each is checked against `ownedBy` first.
  - **A block with no task behind it still goes on the day.** Calls, site visits, an hour on the sales platform: real work that is not a step of any project. It becomes an `AssignedTask` for that one day — the week board under the main board — exactly like a job handed out by hand, and its id is kept on the block so pressing apply twice hands out nothing twice.
- Without `ANTHROPIC_API_KEY`, they all fail softly and nothing else is affected.

### iOS app and mobile API
- `/api/mobile/{login,dashboard,projects,projects/[id],…/comments,…/cover,…/gallery}` use a Bearer token, the same one as the admin cookie. Mobile is admin only.
- The app (`ios/Sources/*.swift`) has the production URL hard-coded in `APIClient.swift`. It is unsigned and meant to be re-signed with AltStore using a free Apple ID, which also means it can't receive push notifications.

### Tests
- `npm test` runs `node --test` over `tests/**/*.test.ts` through tsx, loading `.env` and `.env.local`.
- Pure-logic tests: `analytics`, `payroll`, `progress`, `daily-progress`, `stage-schedule`, `week`, `notifications`, `devices`, `chat-*`, `group-members`, `voice`, `sound-cues`, `viewport`, `client-image`, `image-orientation`, `whatsapp`, `avatar`, `warnings`, `sales`, `performance`, `task-types`, `automation`, `admin-guard`.
- Database tests use the real local database and skip when it is unreachable: `employee-access`, `task-submissions`, `assigned-evidence`, `device-ownership`, `chat-access`, `warnings`, `sales`, `performance`. A run showing `pass 0 … skipped N` with exit 0 never means the tests passed — but it has **two** causes, and they look identical.

- **Run them the way `package.json` does.** `npm test` and `npm run test:db` pass `--env-file-if-exists=.env --env-file-if-exists=.env.local`; a bare `npx tsx --test tests/x.db.test.ts` passes neither, so `DATABASE_URL` is unset, every test skips itself as "no database", and a perfectly healthy database is blamed. Running one file at a time is the documented recovery from a suite that dies mid-run, so the wrong command is reached for at exactly the moment its output is most likely to be believed.
- **The tell, before touching anything:** a real query, run with `--env-file=.env.local`, answers fine at the same moment. That is the same signature as the stale-Prisma-client trap below, and it means the same thing both times — **the database is not the problem, the process asking it is**. Killing and restarting the database on this evidence destroys a working one and teaches you nothing.

---

## Gotchas that have cost time

- **The local `prisma dev` database dies.** Symptoms are `P1001`, "Server has closed the connection", or DB tests cancelled en masse. Recover like this:
  1. Kill whatever listens on ports 51213–51216. In PowerShell: `Get-NetTCPConnection -LocalPort 51213 -State Listen | % { Stop-Process -Id $_.OwningProcess }`.
  2. If you see "Lock file is already being held", delete `%LOCALAPPDATA%\prisma-dev-nodejs\Data\durable-streams\neon-client-portal\server.lock.lock`. This is a marker, not your data.
  3. Run `npm run db:dev` again.
  4. `migrate status` saying "up to date" does **not** prove the database is serving; confirm with a real query.
  5. **A whole-suite `npm test` can kill it even from a rested start**, and `--test-concurrency=1` does not save it. The run dies part-way and you get a handful of failures plus a mass of cancellations — which reads exactly like a regression and is not one. Prove it before believing it: run each `*.db.test.ts` in its own process, one after another. Every file that "failed" passes alone, and that per-file run is a full run this machine survives.
  6. **`npm run build` kills it too.** Twice in one session: a real query answered, a build ran, and the next query came back `P1017`. Nothing in a build needs the database — every route is dynamic — so the only cost is the recovery above. The trap is the order: a `*.db.test.ts` run started after a build reports `pass 0 … skipped N`, which reads exactly like a feature that broke. Run a real query after any build, before believing a test result.
  6. Deleting `…\durable-streams\neon-client-portal` does **not** reset the database. The data lives elsewhere and comes straight back; all that goes is the stream log (it had grown to 14 GB), which is worth doing when `current_schema()` starts coming back `null` — the state in which every unqualified query fails with `42P01`, as though the tables had vanished.
     - **What actually empties `current_schema()` is loading a copy, not the stream log.** Every `pg_dump` file begins `SELECT pg_catalog.set_config('search_path', '', false);` — both copies in `local-backup/` carry it on line 16. On an ordinary server that setting dies with the connection that ran it; `prisma dev` does not give each connection a session of its own, so the empty path outlives the restore and every later connection, the site's included, finds no tables. A restart hands out a fresh session, which is probably why deleting the log and restarting appeared to cure it.
     - **The tell:** on a brand-new connection `current_schema()` is `NULL` while `select count(*) from public."Project"` answers normally. **The cure is one statement,** `select pg_catalog.set_config('search_path', '"$user", public', false)` — not deleting anything. `restore-local-data.mjs` now runs it in its `finally`, so a restore no longer leaves the database like this.
  7. Rows named `zdev-…`, `zsale-…`, `zdep-…` are fixtures left behind by a run that died before cleaning up. They are harmless — the tests pass with them there. `node --env-file=.env.local scripts/restore-local-data.mjs --replace` puts the database back to the copy in `local-backup/`.
- **After `prisma generate`, restart `next dev`.** The running dev server keeps the client it started with, so a model you just added to the schema is `undefined` on the page while `npx tsc --noEmit` passes cleanly against the new client on disk. It arrives as `TypeError: Cannot read properties of undefined (reading 'findMany')` pointing at a `prisma.<newModel>` line, and it reads exactly like a broken query or a dead database.
  - **The tell:** a fresh `node --import tsx -e "…prisma.newModel.count()"` answers fine at the same moment. Same database, same schema, different process. Restart the server, not the database — mistaking this for a dead database is how a working one gets killed.
  - To screenshot a heavy page locally, temporarily add `max: 1` to the `Pool` in `src/lib/db.ts`, restart the dev server, and **don't commit it**.
  - **The test fixtures count too.** Three `*.db.test.ts` files built their rows with `Promise.all` in `before`; the connection closed under them, and the failure then surfaced in whichever file happened to run next — which reads as a regression in a feature that is fine. They create one row at a time now.
- **Every action checks its own session.** Server actions are public endpoints, and the layout redirect isn't a security boundary. The admin check is `requireAdmin` in `lib/admin-guard.ts` — a plain module, deliberately **not** `"use server"`, because every export of one of those becomes callable over the network and a guard that can itself be called is not a guard. Keep queries out of `"use server"` files for the same reason.
- **`deploymentId`** makes a page left open across a deploy reload instead of failing its server actions.
- **Git Bash on Windows** rewrites arguments that start with `/` into Windows paths. Prefix the command with `MSYS_NO_PATHCONV=1`.
- **A panel inside a flex sidebar grows to its own content.** `<aside className="… lg:flex">` makes its child a flex item, and a flex item's `min-width: auto` lets it stretch to its widest unbreakable line. One long chat preview grew the conversation list to **3620px inside a 288px column**, so the times, the unread counts and a button's own label were pushed off and clipped away. `w-full min-w-0` on the panel is the fix.
  - **The symptom lies:** it reads as "my edit never took effect", because every element is present and correctly styled in the DOM — just thousands of pixels to the right. Two separate fixes were aimed at the wrong thing before the page was asked what it had actually rendered.
  - **Ask, don't squint.** A dozen lines of Playwright printing `textContent`, `getBoundingClientRect().width` and `scrollWidth` for the suspect nodes answered it outright, and would have been cheaper than the first guess. Screenshots show what a layout looks like; only the DOM says why.
- **Drive the dev server as `localhost`, never `127.0.0.1`.** `next dev` treats the other spelling as a foreign origin and answers its own chunks with 403, so the page renders, never hydrates, and every click does nothing — with no error in the browser. The dev server's log says "Blocked cross-origin request to Next.js dev resource". Read as a broken feature, this costs an afternoon.
- **`.dockerignore` must keep `whatsapp-worker/`.** `next build` type-checks every `.ts` file, and `tests/whatsapp-queue.test.ts` imports the worker's vendored library — leave the folder out of the image and the build fails with `TS2307`. Render never shows this because it builds from the whole repository.
- **A `$` in `.env.docker` needs single quotes or `$$`.** Inside double quotes Compose substitutes, and the admin password hash arrives three characters short — admin login would fail with nothing wrong in the code. **`docker compose config` prints a literal `$` as `$$`**, so it reports a mismatch even when the value is right: check what a container actually receives (a fingerprint of the value from `docker exec`), never the rendered config.
- **Inserting text with JavaScript's `String.replace` corrupts it when the text contains `$`.** In a replacement string `` $` `` means "everything before the match" and `$$` means `$` — adding the gotcha above that way pasted the whole README into itself twice. Use `split`/`join`, or pass a function as the replacement.
- **Phone layout:** see "Phone frame". Never stretch the frame past the visual viewport, and use the readout.

## Known issues (open)

- ~~**The project area's server actions don't check the admin session.**~~ Fixed: all 27 exports across `lib/actions/{project,gallery,drawing,document,boq,pricing,material,furniture,hotspot}-actions.ts` now call `requireAdmin` from `lib/admin-guard.ts`, as do the admin halves of `approval`/`comment`. The two client actions there stay deliberately open — a client has no login and the project link is the credential — so each of those files now labels its two halves, and both client actions are scoped by token in the `where` rather than trusting an argument.
  - **A missing guard is invisible to every check we run**: it typechecks, it lints, it builds, it passes the tests. So it is proved by counting instead — `grep -c "^export async function"` against `grep -c "await requireAdmin();"`, file by file, must match.
  - **One definition, and a test that keeps it one.** All 25 action files import `requireAdmin`; none writes its own; and `SESSION_COOKIE_NAME` now appears in only the two files that *issue* sessions (`auth`, `employee-auth`). Reading the cookie anywhere else is a guard being written a second time whatever it is called, so `tests/admin-guard.test.ts` asserts both. The eleven local copies were each correct — that was the point of removing them: a primitive does not drift because somebody is careless, it drifts because there are twenty-five chances for one to be edited and the rest not.
- **Arabic breaks `gallery.pdf`.** It uses the Helvetica font, which has no Arabic characters. Zip and PDF filenames also drop non-ASCII characters.
- **Deleting a project or drawing leaves some files in storage:** BOQ images and old drawing revisions.
- **Some analytics events are never logged:** `viewed_render`, `viewed_drawing`, `viewed_boq` and `viewed_pricing` come only from the seed.
- ~~**Status checks are uneven.**~~ Fixed: every state write now goes through `canMove` (`lib/task-transitions.ts`), so sending proof for work already with the manager, or already approved, is refused on both the board and the week board. The week board had no runtime check at all before this and now has the same one as everything else.
- **Unused variable:** `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in `.env.local` isn't read anywhere.
- **The WhatsApp worker's queue is driven by a patch to vendored code.** `nexora-whatsapp` is vendored as `dist` only, and its `WhatsApp` class holds `outbox` privately with no public way in — so `whatsapp-worker/vendor/nexora-whatsapp/dist/index.{js,d.ts}` were edited here to add `pump()` and `restoreQueue()`, and `server.mjs` calls the first every two seconds and the second once on boot. Before that the worker **had never sent a message**: `send` enqueued, the journal filled, the portal answered 202, and nothing ever left. It reads as working from every side — the number links, the card turns green, the send reports success — which is why it went unnoticed until a message was waited for on a second phone.
  - **Two gaps, not one, and the second hid behind the first.** Nothing called `tick()`, so no pass ever ran; and nothing called `restore()`, so after a restart the journal stayed a file nobody read and a pass iterated an empty map. Fixing only the pump leaves new messages sending while a restarted backlog stays invisible — which looks healthier than it is.
  - **A worker that never restores destroys its own backlog on restart.** `shutdown()` persists the queue as it stands in memory, and a process that never restored holds nothing — so it writes an empty list over a journal full of waiting messages. They are not sent, not expired and not reported: they are deleted by the shutdown of a process that never knew about them. That is how the first four test messages were lost, and it is why the boot call matters as much as the timer.
  - **Re-vendoring the library erases all of it and the silence comes back.** `tests/whatsapp-queue.test.ts` is the tripwire: it pins that enqueue alone sends nothing, that a pass sends, that a journalled backlog is unreachable until restored, and that shutting down without restoring wipes it. The durable fix belongs in the library's own source, which is not in this repo.
- **Scheduled notifications have never run in production.** `daily-notifier.yml` stops with an error when the repository secrets `APP_URL` and `CRON_SECRET` are missing, and they were never set: 38 runs from 9 September, none succeeded. So the 08:00 and 16:00 summaries, deadline and stage reminders and the day's follow-up questions have never been sent by schedule; only notifications caused directly by somebody's action went out. GitHub also ran the job every two to five hours rather than every ten minutes, and the two summaries fire only when a run lands inside their hour, so even with the secrets set most would have been missed. `neon-scheduler` in `docker-compose.yml` replaces it once the studio's PC is the real site.

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
| `CLOUDFLARE_TURN_KEY_ID` `CLOUDFLARE_TURN_KEY_API_TOKEN` | Cloudflare TURN for calls (Realtime → TURN in the Cloudflare dashboard). Optional: without them calls use STUN only and cannot connect across networks that forbid direct connections |
| `RENDER_GIT_COMMIT` `RENDER_EXTERNAL_URL` | Set by Render |
