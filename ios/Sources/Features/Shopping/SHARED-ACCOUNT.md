# Office shopping: the shared sign-in (server side is done)

Hand this to Claude on the Mac. The server half is live on
`https://clients.neonjo.com`; what is left is the app filling the form.

## What changed and why

`OfficeShoppingView` today says *"The manager signs the office account in once
on each phone (the web view keeps its own cookies), so nobody on the team needs
the password."* That was the right design, and the studio has chosen a different
one: the manager sets the shop account **once**, centrally, and every phone
signs itself in.

The trade-off was put to Hamed plainly before this was built, and he took it:

> Everyone on the team can read that password. For a phone to type it into the
> shop's sign-in page the server has to hand over the real thing, so any
> employee can call the endpoint with their own token and read it. Encryption
> protects a stolen database copy and nothing else.

So **delete the "nobody on the team needs the password" claim from the view's
comment and from the on-screen copy** — it is no longer true, and a comment that
says a secret is safe when it is not is worse than no comment.

## The endpoint

    GET /api/mobile/get/me/shopping/account
    Authorization: Bearer <the employee's existing token>

Signed in, and set up:

    { "account": { "email": "...", "password": "...", "site": "https://www.yasermallonline.com/" },
      "why": null }

Not set up, or stored under a `SESSION_SECRET` that has since changed:

    { "account": null,
      "why": "The office shop account isn't set up yet. Ask the manager." }

`site` is optional and may be null — fall back to `OfficeShop.home`.

**`why` is a sentence to show, not a code to branch on.** Put it on the screen
where the web view would have been, with no retry button: nothing the person can
do from their phone will fix it, and the sentence already says who can.

**Every fetch is recorded** against the person who asked, and the manager sees
"Last taken by …" in Settings. So fetch it when the shop screen opens and the
web view is not already signed in — not on every app launch, and not on a timer.

## Filling the form

The account is for the supermarket's own site, so the app has to drive that
site's sign-in page. Nothing about it is ours, which means:

- **Find the fields rather than assuming them.** A selector hard-coded today is
  a silent breakage the next time the shop redesigns, and the symptom is a blank
  web view that reads as a broken app.
- **Only ever on the shop's own origin.** Check the host before injecting
  anything; a redirect to a payment provider must never be typed into.
- **If it cannot be filled, leave the page alone** and let the person sign in by
  hand — the password is on the screen in front of them. Say that, rather than
  spinning.
- The web view keeps its cookies, so this is once per phone per session, not
  once per visit.

## Still true, and still the point

Only the manager places the order. `OfficeShop.isCheckout` and the blocked
handler stay exactly as they are — the shared sign-in means every phone is now
on an account that *could* order, so that block is carrying more weight than it
did before, not less.

## Where the manager sets it

`/admin/settings` → **The office shop account**: email, password, optional site,
and a Remove button. Manager only (`requireAdmin`); the password box left blank
keeps the stored one. The page carries the warning above, on screen.

Server files, for reference: `src/lib/office-shop-account.ts` (the store and the
fetch record), `src/lib/secret-box.ts` (encryption at rest, and an honest
comment about what it does not protect), `src/lib/actions/settings-actions.ts`.
