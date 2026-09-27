# Prompt for Claude on the Mac — the NEON iOS app

Paste everything below the line into Claude Code on your Mac, in the folder
where you cloned this repository.

---

You are building the iOS app for NEON, an interior-design studio in Amman. The
web platform already exists and is live; you are adding a native client to it,
not starting a system.

## The first rule: one source of truth

Everything the app shows comes from the live server over HTTP. **Do not create a
database, a local store of record, mock data, sample JSON, or a "demo mode".**
If a screen needs data the API does not expose, that is a missing endpoint — say
so and stop, do not invent a stand-in. The studio runs on this data: an app that
shows its own copy of it is worse than an app that shows nothing.

Caching for offline reading is fine and good (URLCache, or your own), as long as
it is plainly a cache of what the server said and never the authority.

## Where the server is

**`https://clients.neonjo.com`** — the mobile API is at `/api/mobile/*`.

That is the real, live studio server. It runs in Docker on a Windows PC in the
office and is published through a Cloudflare tunnel, so it is reachable from
anywhere with no VPN and nothing to set up. You do **not** need access to the
containers, the database or the tunnel — they are on a different machine, and
everything you need is already served over this URL. Ask for a LAN address only
if you find a concrete reason the public one will not do.

Check it works before you write any app code:

```
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  -H "content-type: application/json" -d '{"password":"wrong"}' \
  https://clients.neonjo.com/api/mobile/login
```

`401` is the healthy answer — it means the route is live and rejecting a bad
password.

## Signing in

`POST /api/mobile/login`

- **Somebody on the team:** `{ "email": "...", "password": "..." }` →
  `{ token, side: "EMPLOYEE", id, name }`
- **The manager:** `{ "password": "..." }` (the studio's single admin password,
  no email) → `{ token, side: "ADMIN" }`

Every other call carries `Authorization: Bearer <token>`. The token is a signed
string, not a session on the server, and it lasts 7 days.

Two things follow that you must respect:

- **Store it in the Keychain**, never in `UserDefaults` and never in a file.
- **A 401 means sign in again.** The employee's row is re-read on every request,
  so somebody disabled in the admin loses the app on their next tap. Handle that
  as "you have been signed out", not as an error to retry.

Ask Hamed for the credentials. Do not put any password or token in the source,
in a `.plist`, or in a commit.

## What the API gives you today

All of these are live. Anything not on this list does not exist yet.

**Whoever is signed in**
| Route | What it is |
|---|---|
| `GET /api/mobile/me` | Who this token belongs to |
| `GET /api/mobile/today` | The signed-in employee's day |
| `GET /api/mobile/notifications` · `POST .../read` | Their notifications |

**Work**
| Route | What it is |
|---|---|
| `GET /api/mobile/tasks` | The employee's own tasks |
| `GET /api/mobile/tasks/[id]` | One task: what to hand in, what counts as done, what it waits on |
| `POST /api/mobile/tasks/[id]/status` | `{ state }` — a state change with no file |
| `POST /api/mobile/tasks/[id]/proof` | **Multipart.** Hand in finished work: `photo` (required — an image, PDF, drawing, spreadsheet or ZIP) and `note`. Takes either kind of work, a board cell or a job handed out by hand. Answers `{ ok, submissionId, state: "SUBMITTED" }` |

**Chat**
| Route | What it is |
|---|---|
| `GET /api/mobile/chat/conversations` | The list, with unread counts |
| `GET/POST /api/mobile/chat/messages` | Read, and send. **POST takes JSON or multipart**: `{ conversation, body }` as JSON for text, or multipart with `photo`, `document` or `voice` (+ `durationSeconds`) to attach something |
| `POST /api/mobile/chat/read` | Mark a conversation read |

**Manager only** (an admin token)
| Route | What it is |
|---|---|
| `GET /api/mobile/dashboard` | The manager's overview |
| `GET /api/mobile/projects` · `/projects/[id]` | Projects and one project in full |
| `GET /api/mobile/projects/[id]/gallery` | A project's rooms and renders |
| `POST /api/mobile/projects/[id]/gallery` · `/cover` | **Multipart upload** — these two already accept files |
| `POST /api/mobile/projects/[id]/comments` | Comment on a project |

Scoping is enforced on the server, not by the app: an employee asking for
another person's task gets a 404, not a 403, so ids cannot be used to discover
what exists. Do not build your own permission checks on top — mirror what the
server says.

## What is missing, and what to do about it

Be honest about these in your plan rather than working around them.

1. **Do not send a bare `SUBMITTED`.** `/tasks/[id]/status` will take it and it
   is the wrong call: finishing a task at NEON means sending a photo of the
   finished work, and the manager's review queue would fill with claims and no
   evidence. Use `/tasks/[id]/proof` with the file. "Done" is still only ever
   written by the manager, after reviewing it — never build a control that lets
   somebody complete their own work.
2. **No push notifications.** There is no APNs key and nowhere to store a device
   token; the web app uses web push, which a native app cannot receive. If you
   want push, that is server work plus an Apple key, and it needs asking for.
3. **Not everything the web has is exposed.** The WhatsApp inbox, the site-visit
   diary, payroll, attendance, reviews and the week board have no mobile routes.
   Build against what exists; list what you would need.

Both upload routes were built and tested against the live server on
2026-09-27: a PDF handed in as proof comes back `SUBMITTED` with the manager
notified, and a photo posted to a chat comes back as an `IMAGE` message with
its attachment stored. The shapes above are what the server actually answers,
not what it is supposed to.

When you need an endpoint, write down the exact route, method, request and
response you want, and hand that to Hamed — the server is changed on the Windows
PC, not from your Mac.

## The app that is already here

`ios/` holds **NeonAdmin**, a small SwiftUI app: `APIClient.swift`,
`LoginView.swift`, `DashboardView.swift`, `ProjectDetailView.swift`,
`Models.swift`, `DesignSystem.swift`, `Localization.swift`. The project is
generated with XcodeGen from `ios/project.yml` — **there is no `.xcodeproj` in
the repository**, so run `xcodegen generate` in `ios/` first.

It is admin-only and it hardcodes the production URL in `APIClient.swift`.

Decide, and say which you are doing and why: extend this app to cover employees
as well, or build a second target beside it. Extending is usually right — the
sign-in already returns `side`, so one app can be both.

## How the studio works, so the app matches it

- **English and Arabic.** Most of the team writes Arabic. Every text view that
  shows content from the server needs correct right-to-left handling; the web
  uses `dir="auto"` per message for exactly this.
- **"Done" belongs to the manager.** An employee sends proof; the manager
  approves it. Never build a control that lets somebody mark their own work
  complete — the server refuses it, and offering the button is a lie.
- **Silence is never a verdict.** Nothing in this platform reads "no answer" as
  "did not work". Do not add a screen that does.

## Working rules

- Read `README.md` in this repository first. It is long, current, and written
  for exactly this — it will tell you where things are without reading the code.
- **Never change the server from the Mac.** The API, the database and the web
  app are deployed from the office PC. If your work needs a server change,
  write the request down and hand it over.
- Do not commit secrets. Do not commit an `.xcodeproj`.
- The app is unsigned and sideloaded with AltStore on a free Apple ID, which
  also means it cannot receive push notifications. If App Store distribution is
  the goal, say what that changes — signing, capabilities, privacy strings —
  before building towards it.

## Start here

Do not write app code first. Start by:

1. Running the curl above, then signing in with the credentials Hamed gives you
   and calling `/me`, `/today` and `/chat/conversations` with the token — paste
   the real shapes you get back.
2. Writing a short plan: which screens, built on which endpoints, what is
   missing, and whether you are extending NeonAdmin or building beside it.

Then show Hamed the plan and wait.
