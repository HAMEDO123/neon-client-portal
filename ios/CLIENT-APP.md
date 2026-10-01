# Prompt for Claude on the Mac — the NEON **client** app

Paste everything below the line into Claude Code on your Mac, in the folder
where you cloned this repository.

---

You are building a second iOS app for NEON, an interior-design studio in Amman.

**It is not the staff app.** `ios/` already holds **NeonAdmin** (bundle id
`com.neonjo.staff`), which the manager and the team sign in to. This is a
different app for a different audience: the studio's **clients**, each of whom
sees one project — their own — and nothing else. Two targets, two bundle ids,
two App Store listings. Decide and say whether you are adding a target beside
NeonAdmin in `ios/project.yml` or starting a second XcodeGen project; adding a
target is usually right, because the design system and the networking are worth
sharing and the two apps will otherwise drift.

## Why it exists

Until now the studio sent each client a link — `https://clients.neonjo.com/p/<token>`
— and that link *is* the credential: no login, no password, whoever holds it
can see the project. That still works and is not going away.

What it cannot do is live on a phone's home screen with the studio's name under
it. So the same project is now reachable with a **code** the studio reads out
or sends: eight characters, shown as `W8BZ-49S2`. The client types it once, and
the app remembers it.

## The first rule: one source of truth

Everything comes from the live server over HTTP. **Do not create a database, a
local store of record, mock data, sample JSON, or a "demo mode".** Caching for
offline reading is fine and good, as long as it is plainly a cache of what the
server said and never the authority. If a screen needs something the API does
not expose, that is a missing endpoint — say so and stop, do not invent a
stand-in. A client app showing its own copy of a project is worse than one
showing nothing.

## Where the server is

**`https://clients.neonjo.com`** — the client API is at `/api/client/*`. It is
live now. Check before writing any app code:

    curl -s -X POST https://clients.neonjo.com/api/client/login \
      -H 'content-type: application/json' -d '{"code":"AAAA-BBBB"}'

A refusal saying the code is not right is the healthy answer — the route is
live and rejecting a wrong code.

Ask Hamed for a real code to develop against. **Do not put one in the source,
in a plist, or in a commit**: a code opens a real client's project.

## Signing in

`POST /api/client/login` with `{ "code": "W8BZ-49S2" }`

- **200** gives `{ token, name, clientName }`
- **401** — the code is not right
- **403** — the code is right but the project is a draft or archived. **Show
  what the server says.** These are not bad codes, and telling a client their
  code is wrong when it is their project that is not ready is how the studio
  gets a phone call.
- **429** — too many tries; wait a few minutes.

The code may be typed in any case, with or without the dash, with spaces, and
with `O` for zero or `I`/`l` for one — the server folds all of that. Do not
validate the shape in the app beyond "they have typed something": the server is
the only thing that knows what a real code looks like, and a client whose code
your regex rejects cannot get in at all.

**What comes back is the project's token, and that is what you keep.** Store it
in the Keychain. Every other call carries `Authorization: Bearer <token>`.

There is no session and nothing expires. The manager can regenerate either the
link or the code; when they do, the token stops working and the app gets a 401
on its next call — treat that as "you have been signed out", clear the Keychain
and the cache, and send them back to the code screen with the server's sentence.

**A client may have more than one project.** Nothing stops you keeping several
tokens and letting them switch. Ask Hamed whether that is wanted before building
it; one project is the common case.

## What the API gives you

| Route | What it is |
|---|---|
| `POST /api/client/login` | Code to token. Above. |
| `GET /api/client/project` | **The whole project, in one answer.** |
| `POST /api/client/comments` | `{ message, authorName?, refLabel? }` — writing to the studio |
| `POST /api/client/approvals/[id]` | `{ status, note?, clientName? }` where status is `APPROVED` or `CHANGES_REQUESTED` |

`GET /api/client/project` answers with `project`, `spaces`, `drawings`,
`documents`, `boq`, `pricing`, `materials`, `furniture`, `approvals`,
`comments`. **Call it and paste the real shape into your plan** rather than
working from this list — `src/lib/client-payload.ts` is what builds it, and the
server is the truth.

One call for the whole project is deliberate: a phone on a Jordanian mobile
connection pays for every round trip, and the server already reads it all in one
query. Fetch it once on open, re-fetch on pull-to-refresh.

### What the manager chooses to show

A project carries visibility switches, and **the server enforces them by
leaving things out of the answer** — not by asking you to hide them. So:

- `pricing` is **null** when the manager has not shared pricing. `materials[].price`
  and `furniture[].price` are null too, and the BOQ carries no rate and no total.
- `boq[].quantity` is null when quantities are not shared.
- `pricing.items` is empty with `itemsShown: false` when only the total is shared.

The payload also says which of these are on: `showsPricing`,
`showsBoqQuantities`, `showsBoqPrices`. **Use them to explain an empty section,
never to decide what to draw** — "NEON hasn't shared pricing for this project
yet" reads as a choice; a blank tab reads as a broken app.

`project.allowDownloads` says whether the download routes will answer. Do not
draw a download button when it is false: the route returns 404, and the client
learns nothing from a button that fails.

### Files

Drawings and documents carry a `fileUrl` you can open directly. The whole
project is also packaged by the website, and you hold the token, so you can
build these:

- `/p/<token>/gallery.pdf` — every render as a PDF
- `/p/<token>/handover.zip` — the lot

Both answer 404 unless the project is published **and** `allowDownloads` is on.

## Approvals, which is the one place a client changes something

An approval is the studio asking "is this right?". POST the answer:

- `APPROVED` needs no words.
- `CHANGES_REQUESTED` **requires a note** — the server returns 400 without one,
  because "please change it" with nothing written tells the studio less than the
  question did. Ask for the words in the app rather than letting the server
  refuse the tap.

An answer is not a draft. Once sent, the studio sees it. Say so before sending.

## How the studio works, so the app matches it

- **English and Arabic.** Most of the studio's clients read Arabic; the website
  carries a full `AR` dictionary and a language toggle, and the app needs the
  same. Every text view showing content from the server needs correct
  right-to-left handling — the web uses `dir="auto"` per string for exactly this.
  `ios/Sources/Core/Localization.swift` and `ios/Resources/ar.lproj/` are the
  staff app's arrangement; follow it.
- **The client is a guest, not a user.** No account, no settings, no profile, no
  push — there is no device-token route for clients and none is planned. The
  only thing the app remembers is the token.
- **Silence is never a verdict.** Nothing in this platform reads "no answer" as
  "did not care", and no screen here may either.
- **It is their home, not a dashboard.** The website leads with the renders.
  Follow it: pictures first, the detail behind them.

## App Store, which the staff app never had to face

NeonAdmin goes out through TestFlight to five people. This one goes to the
public App Store and will be reviewed. Before building towards it, write down
what that needs and get Hamed to agree it:

- A **privacy policy URL**, and the privacy questionnaire — the app takes a code
  and whatever a client types into a comment.
- **Guideline 4.2, minimum functionality**: an app that is a wrapper around a
  web page is rejected. This one is native screens over a JSON API, which is
  fine, but the review notes should say so plainly.
- **A demo code.** Review needs a working one. Ask Hamed for a project kept
  published for exactly that, and put the code in App Store Connect's review
  notes — never in the app.
- **Sign in with Apple** is *not* required: that rule applies to apps offering
  third-party sign-in, and this offers none.
- Bundle id, name and icon are Hamed's to choose. Suggest, do not assume.

## Working rules

- Read `README.md` in this repository first — it is long, current, and will tell
  you where things are without reading the code.
- **Never change the server from the Mac.** The API, the database and the web app
  are deployed from the office PC. If your work needs a server change, write down
  the exact route, method, request and response you want and hand that over.
- Do not commit secrets, a real access code, or an `.xcodeproj`.

## Start here

Do not write app code first.

1. Run the curl above. Then sign in with the code Hamed gives you and call
   `/api/client/project` with the token — **paste the real shapes you get back**.
2. Write a short plan: which screens, on which parts of that payload, what is
   missing, and whether you are adding a target to `ios/project.yml` or starting
   a second project.

Then show Hamed the plan and wait.
