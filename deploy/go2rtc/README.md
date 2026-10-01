# The studio's cameras (CCTV)

The manager watches the studio's TP-Link **Tapo** cameras live in the NEON app,
from anywhere — and turns the ones that pan and tilt. Three pieces:

| Piece | Where | What it does |
|---|---|---|
| The cameras | the office network | Tapo cameras, each with a fixed IP address |
| **`neon-cameras`** | Docker, on this PC | The relay ([go2rtc](https://github.com/AlexxIT/go2rtc) 1.9.14, which brings its own ffmpeg). It talks to the cameras on the office network and turns their video into pictures a phone can show. It is **not on the internet**: only this PC (`127.0.0.1:1984`) and the site (`neon-app`) can reach it. |
| The app | the manager's phone | **Cameras**: every camera as a live tile, tap one to watch it, **+** to add one. The site checks it is the manager on every request. |

Cameras are **added in the app** — nothing here needs editing. The app's list is
kept in the site's database with the passwords sealed, and the site tells the
relay about each camera while it runs.

---

## Setting it up (once)

**1. Start the relay.** It starts with everything else:

```
docker compose --env-file .env.docker up -d
```

or on its own: `docker compose --env-file .env.docker up -d neon-cameras`.

Check it: `docker ps` lists **`neon-cameras`** as `healthy`, and
<http://127.0.0.1:1984> opens go2rtc's own page on this PC.

**2. Rebuild the site**, as for any update, so it has the camera routes:

```
docker compose --env-file .env.docker --profile public up -d --build
```

**3. For each camera, in the Tapo app on your phone:**

1. **Make a Camera Account.** The camera → **⚙︎** (top right) → **Advanced
   Settings** → **Camera Account** → choose a username and a password.
   This is *not* your Tapo login; it is a separate account that only lets
   other programs see (and move) this camera. The same username and
   password can be used on every camera.
2. **Find its IP address.** The camera → **⚙︎** → **Device Info** →
   *IP Address* (for example `192.168.1.21`). The router's list of connected
   devices shows it too.
3. **Fix that address in the router.** In the router's settings, give the
   camera a **DHCP reservation** (often called *Address Reservation* or
   *Static lease*) so it always gets this same address. Without it, the
   camera can come back with a different address after a power cut, and the
   app loses it.

**4. In the NEON app:** Cameras → **+** → a name (Arabic is fine), the IP
address, the Camera Account's username and password → **Save and test**. The
app tries the camera straight away and says what happened in plain words —
connected, or why not. A camera is saved either way, so one that is switched
off today is still there tomorrow.

To change a camera later, hold its tile → **Edit** (leave the password empty
to keep the saved one), **Test connection** or **Remove**.

---

## What the app does

- **The grid** — every camera, its picture refreshed about every two seconds
  while the screen is open (a red **LIVE** when the picture is fresh,
  **No picture** when the camera does not answer).
- **Watching one** — the live picture, full screen; pinch or double-tap to
  zoom, swipe to the next camera, turn the phone for landscape, **HD** for the
  camera's full picture, the download button saves the picture to Photos.
- **Moving one** — cameras that pan and tilt (C200, C210, C220, C225, C500 …)
  get a stick: hold to turn, let go to stop. Positions saved in the Tapo app
  appear as buttons. This goes over the camera's ONVIF (port 2020) with the
  Camera Account.
- **With the Tapo login instead** (an email and the Tapo password): the app
  still shows the picture, through go2rtc's own Tapo connection, but cannot
  move the camera. A Camera Account does both, and is the recommended way.

**Data used by the phone:** the small picture live is about 1.5–2 Mbit/s;
**HD** (1280 wide, 10 pictures a second) about 4–6 Mbit/s; the grid about
15 KB per camera every two seconds. However many phones watch, the relay keeps
one or two connections to each camera — Tapo cameras allow only a few.

---

## When something is wrong

| The app says | What to do |
|---|---|
| *The camera relay on the office PC isn't running.* | `docker compose --env-file .env.docker up -d neon-cameras`, then `docker logs neon-cameras`. |
| *The office PC can't reach a camera at …* | Wrong IP address, or the camera is off / off the network. Check the address in the Tapo app and the router reservation. |
| *The camera refused the username or password …* | Use the **Camera Account** (step 3.1), not the Tapo login; type it again. |
| *… isn't accepting video connections …* | The camera has no Camera Account yet (step 3.1). |
| *The camera closed the connection …* | Too many viewers on the camera itself — close the Tapo app on other phones, or restart the camera. |
| Pictures but no live picture | `docker logs neon-cameras` shows what ffmpeg said. |
| A camera refuses an account that is right | Restart the camera (unplug it for ten seconds) and update its firmware in the Tapo app. Some recent Tapo firmware has a **Third-Party Compatibility** switch (Tapo app → Me → Tapo Lab); if yours has it, turn it on. |

---

## How it works (for whoever looks after it)

- **The list** lives in the site's database: the AppSetting `cameras`, sealed
  with `lib/secret-box.ts` (like the office shop's session), so a database
  backup carries no camera password. The phone is only ever told
  `{ id, name, ip, username, hasPassword, … }`.
- **The relay forgets, the database does not.** The site registers every
  camera with go2rtc through its API — four streams each,
  `neon_<id>_hd` / `_sd` (the camera's `stream1` / `stream2`) and `_live` /
  `_livehd` (MJPEG made from those by ffmpeg) — in go2rtc's memory only. A
  restart of the relay forgets them; the site registers them again the next
  time the list or a picture is asked for, and drops any it no longer has.
- **`neon.yaml`** (committed, nothing secret) is NEON's go2rtc settings: a
  quicker ffmpeg start, and the HD picture's size and rate.
- **`go2rtc.yaml`** (git-ignored, optional) is go2rtc's own file. go2rtc writes
  into it the *names* of the cameras it keeps connected (`preload:` — never a
  password), and it is where a camera can be written by hand (below).
- **`CAMERAS_RELAY_URL`** tells the site where the relay is (default
  `http://neon-cameras:1984`, the Compose service). Only set it if the relay
  runs somewhere else.

### A camera written by hand (advanced, optional)

For a camera the app cannot add, copy `go2rtc.example.yaml` to `go2rtc.yaml`
in this folder, fill it in as its comments say, and restart the relay:

```
docker compose --env-file .env.docker restart neon-cameras
```

The app lists it by its name there (`front_door` → "Front Door"; a number in
front, like `2_studio`, only sets the order), and can show it, but not edit it
or move it. `go2rtc.yaml` holds passwords: it is git-ignored and kept out of
the site's image — keep it that way.
