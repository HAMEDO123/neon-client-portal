# Request for the office PC — calls and the manager's tasks on the mobile API

Paste everything below the line into Claude Code on the office PC. It is
server work only; the iOS side is built on the Mac once these routes are live.

---

The iOS app (`ios/`, see `ios/PLAN.md`) signs in through `/api/mobile/login`
and carries a Bearer token. Two things the studio uses every day are
unreachable from it, because the routes behind them only accept a browser:

1. **Calls.** `/api/calls`, `/api/calls/signal` and `/api/calls/stream` read
   the viewer with `getChatViewer` (cookies) and refuse anything that fails
   `sameOrigin`. A phone app has no cookie jar and no origin.
2. **The manager's tasks.** Reviewing proof, the day board and handing work
   out are server actions behind `requireAdmin`, which the app cannot call.

Please add Bearer-token siblings for both. Keep one implementation per rule:
move each route's body into `src/lib` and have the web route and the mobile
route both call it, the way `chat-send.ts` and `task-proof.ts` were done. Do
not copy the logic, and do not loosen the web routes.

## 1. Calls — `src/app/api/mobile/calls/…`

Same behaviour as the web routes, but the viewer comes from
`mobileViewer(request)` and there is **no `sameOrigin` check**. That matches
the reasoning at the top of `lib/mobile-auth.ts`: a bearer token is only
attached by the app holding it, so there is no cross-site request to forge.

```
POST /api/mobile/calls
  { "action": "start", "conversation": "team"|"manager"|<id>, "kind": "AUDIO"|"VIDEO" }
      → 200 { …startCall result…, "iceServers": [...] }
  { "action": "join"|"decline"|"leave"|"heartbeat", "callId": "<id>" }
      → 200 same bodies as /api/calls
  401 no/invalid token · 400 "Calls cannot be made in this chat." · 409 CallError message

POST /api/mobile/calls/signal
  { "callId": "<id>", "signals": OutgoingSignal[] }   → 200 { "sent": n }

GET  /api/mobile/calls/stream        (Authorization: Bearer …)
  text/event-stream, exactly the web stream's events:
  ready { me, name, iceServers, relay } · calls [...] · signals [...] with `id:`
  Honour Last-Event-ID the same way.
```

The conversation names are the ones `/api/mobile/chat/messages` already
takes. The web and the phone must interoperate — a call started from a
browser must ring the app and the other way round — so signals, the data
channel messages and the sweep rules stay exactly as they are.

**Not in scope, and why:** ringing a phone whose app is closed needs PushKit
+ CallKit and a paid Apple Developer account (APNs VoIP). An AltStore
free-Apple-ID install cannot receive it. Until then, the app rings only
while it is open, like the web.

## 2. The manager's tasks — admin token only (`requireMobileAuth`)

### Reviews (most important: finishing work is blocked on it)
```
GET  /api/mobile/reviews
  → 200 { "submissions": [ {
        "id", "imageUrl", "note", "createdAt", "outcome", "checkedAt",
        "employee": { "id", "name" },
        "subject": { "kind": "entry"|"assigned", "id", "name", "projectName"|null },
        "checks": [ { "criterion", "verdict", "evidence", "gap" } ]   // SubmissionCheck rows
      } ] }                                                            // PENDING only, newest first

POST /api/mobile/reviews/[submissionId]
  { "decision": "approve"|"reject", "note"?: string }
  → 200 { "ok": true, "state": "DONE"|"IN_PROGRESS" }
  404 not found · 409 already reviewed
```
Extract the cores of `approveSubmission` / `rejectSubmission`
(`lib/actions/submission-actions.ts`) so the server action and this route run
the same code, including `settle`, the notification and the state log.

### The day board
```
GET /api/mobile/day?day=YYYY-MM-DD      (default: today in the studio's timezone)
  → 200 { "dayKey", "people": PersonDay[] }       // dayBoard(dayKey), as the admin home reads it
```
Read-only. Silence stays "unanswered", never a verdict — the same wording
rules as `components/admin/day-board-list.tsx`.

### Jobs handed out by hand (AssignedTask)
```
GET  /api/mobile/jobs?week=YYYY-MM-DD   (admin: everybody's for that week; Sunday start, lib/week.ts)
POST /api/mobile/jobs                   (admin) createAssignedTask's fields as JSON:
  { "employeeId", "title", "note"?, "startDay", "endDay", "priority"?,
    "deliverable"?, "acceptance"?, "estimateHours"? }  → 200 { "job": {…} }
POST /api/mobile/jobs/[id]/state        (admin) { "state": "TODO"|"IN_PROGRESS"|"DONE" }
```
And for an **employee** token, the list the app is missing today (their own
jobs are only reachable through chat cards right now):
```
GET  /api/mobile/jobs?filter=open|completed|all   → 200 { "jobs": [ { "id", "title", "note", "startDay",
      "endDay", "state", "priority", "deliverable", "acceptance", "estimateHours", "blockedReason",
      "chatTaskId", "completedAt" } ] }            // scoped by the token's employee id
GET  /api/mobile/jobs/[id]                         → 200 { "job" } · 404 when not theirs
POST /api/mobile/jobs/[id]/status  { "state": "TODO"|"IN_PROGRESS" }   (canMove, "employee")
```
Proof for a job already works through `/api/mobile/tasks/[id]/proof`.

## When it is done

Deploy (`docker compose --env-file .env.docker --profile public up -d --build`)
and confirm each new route answers **401** without a token:
```
for p in calls calls/signal reviews jobs; do
  curl -s -o /dev/null -w "$p %{http_code}\n" -X POST https://clients.neonjo.com/api/mobile/$p; done
curl -s -o /dev/null -w "stream %{http_code}\n" https://clients.neonjo.com/api/mobile/calls/stream
curl -s -o /dev/null -w "day %{http_code}\n"    https://clients.neonjo.com/api/mobile/day
```
Then tell the Mac, and the app side gets built against the live routes.
