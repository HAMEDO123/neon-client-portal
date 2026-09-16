# NEON Studio on a Mac

Two ways to get the platform out of a browser tab and into the Dock as an
application. The first needs no files at all and is the one to try first.

---

## 1. Safari's own way — 15 seconds, nothing to install

macOS 14 (Sonoma) and later can turn any site into a real web app:

1. Open **https://clients.neonjo.com/admin** in Safari.
2. **File → Add to Dock…**
3. Name it *NEON Studio* and press Add.

It gets its own Dock icon, its own window with no address bar, it shows up in
Launchpad and in ⌘-Tab, and it keeps its own sign-in. Notifications work the
way they do in Safari.

This is a genuine macOS web app, not a shortcut — prefer it unless you are on
an older macOS or you want the window to be Chrome.

---

## 2. `NEON Studio.app` — the bundle in this folder

A small application that opens the platform in Chrome's app mode: one window,
no tabs, no address bar. Use it on macOS 11–13, or if you would rather the
window were Chrome than Safari.

**Copying it over from the studio PC:**

```sh
# 1. Put it where applications live
cp -R "NEON Studio.app" /Applications/

# 2. Windows cannot mark a file executable, so the Mac has to be told
chmod +x "/Applications/NEON Studio.app/Contents/MacOS/neon"

# 3. Optional: give it the NEON icon instead of the generic one
./make-icon.sh
```

**The first time you open it**, macOS will refuse it — it was not downloaded
from the App Store and is not signed by a paid developer account. Right-click
(or Control-click) the app, choose **Open**, then **Open** again in the dialog.
macOS remembers the decision; after that it opens with a normal double-click.

If it was zipped or emailed, macOS may also quarantine it:

```sh
xattr -dr com.apple.quarantine "/Applications/NEON Studio.app"
```

**What it opens:** `https://clients.neonjo.com/admin`. To point it elsewhere —
the employee portal, or a local address while testing — change the single `URL`
line at the top of `Contents/MacOS/neon`.

**Signing in** uses the ordinary Chrome profile, so if you are already signed in
to the admin in Chrome, the app opens already signed in. The comment in the
launcher explains how to give it a profile of its own instead.

---

## Which to choose

| | Safari's Add to Dock | `NEON Studio.app` |
|---|---|---|
| Needs macOS 14+ | yes | no (11+) |
| Files to copy | none | the bundle |
| Gatekeeper prompt | never | once |
| Browser engine | Safari | Chrome / Edge / Brave |
| Web push notifications | yes | yes, through Chrome |

Neither is a native app: both are the same website in a window of its own, so
whatever is deployed to `clients.neonjo.com` is what they show.
