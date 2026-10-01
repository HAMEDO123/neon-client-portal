# Office shopping: one sign-in for the whole office (server side is done)

Hand this to Claude on the Mac. The server half is live on
`https://clients.neonjo.com`.

## What the studio asked for

> I sign in to the shop from my account, and the shopping on every employee's
> phone uses my account.

## Why it is a session and not a password

The first attempt stored an email and a password, because that is what a shop
account usually is. **Yaser Mall has neither.** Its sign-in is a phone number
and an SMS code — `أدخل رقم الهاتف` → `متابعة`. There is nothing to store, and
the code arrives on the manager's phone, so nothing an employee's handset could
type would ever get in.

So: the manager signs in on **their own phone**, where the SMS lands, and hands
that signed-in session to the office. Every other phone loads it before opening
the shop and is already in.

`OfficeShoppingView`'s comment still says *"The manager signs the office account
in once on each phone … so nobody on the team needs the password."* **Both
halves of that are now wrong** — it is once in total, not once per phone, and
there is no password in it at all. Fix the comment and the on-screen copy.

## The endpoints

**Read, any signed-in employee:**

    GET /api/mobile/get/me/shopping/session

    { "session": { "cookies": [ … ], "site": "https://www.yasermallonline.com/" },
      "why": null }

    { "session": null,
      "why": "The office isn't signed in to the shop yet. Ask the manager to sign in and share it." }

`why` is a sentence to put on the screen, not a code to branch on. Show it where
the web view would have been, with no retry button — nothing the person can do
from their phone will fix it, and the sentence says who can.

**Share, the manager only** (an admin token; an employee's gets 403):

    POST /api/mobile/do/me/shopping/share
    { "args": [ [ …cookies… ], "https://www.yasermallonline.com/" ] }

A cookie is `{ name, value, domain, path, expires, secure, httpOnly }` —
`expires` in seconds since the epoch, or null for a session cookie. Anything
without a name or a domain is dropped; at most 100 are kept.

## The app's half

- **On the manager's phone:** after they sign in, a **Share with the office**
  button. Read `WKWebsiteDataStore.default().httpCookieStore.getAllCookies()`,
  keep the shop's own domain and nothing else, POST them. Confirm with what came
  back (`cookies: N`), because a share that silently sent nothing is the failure
  nobody would notice until the team could not shop.
- **On everybody's phone:** before the first load of the shop, fetch the session
  and `setCookie` each one into the same store, then load. The store persists, so
  this is once per phone per session rather than once per visit.
- **When the shop logs the office out**, phones see its login page again. Detect
  it if you can and say "Ask the manager to sign in again"; if you cannot, the
  login page itself is not a disaster — it is what happens today.

## Still true, and now carrying more weight

Only the manager places the order. `OfficeShop.isCheckout` and the blocked
handler stay exactly as they are: every phone is now on an account that *could*
order, so that block matters more than it did, not less.

## Where the manager sees it

`/admin/settings` → **The office shop sign-in**: whether the office is signed
in, who shared it and when, who last used it, and a button to sign the whole
office out. The sign-in itself is not on that page, and the page says why.

Server files: `src/lib/office-shop-account.ts` (the store, the record of who
used it, and the whole of why it is a session), `src/lib/secret-box.ts`
(encryption at rest, and an honest comment about what it does not protect),
`src/lib/mobile/registry/me.ts`.

## Built (the Mac side) — and the one thing the cookies missed

**Yaser Mall keeps its sign-in in local storage, not in a cookie.** Its own
code: after the SMS code is accepted, `localStorage.setItem("wk_token",
t.wk_token)`, and every API call carries it as the `wk_token` / `Wk-Token`
headers. A share of cookies alone therefore signed nobody in.

So the share carries the shop's local-storage entries too:
`POST me/shopping/share` with `args: [cookies, site, storage]`, where
`storage` is `[{ origin, key, value }]` (https origins only, ≤ 50 entries,
values ≤ 8 KB — `src/lib/office-shop-storage.ts`, tested). They are sealed with
the cookies, and `me/shopping/session` answers `{ cookies, storage, site }`. A
session shared before this (cookies only) still reads.

The app: the manager's phone has **Share with the office** (the people button
in the shop's top bar) — it refuses while the shop is still asking to sign in,
and says how many cookies and saved items went. A team member's phone fetches
the session once per run (never into the disk cache), sets the cookies, adds a
document-start script that puts the entries back on the shop's own origin on
every load, then opens the shop. If the shop shows its phone-number sign-in
anyway, a banner says "Ask the manager to sign in and share it again".
