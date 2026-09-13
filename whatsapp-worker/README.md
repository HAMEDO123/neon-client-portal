# NEON WhatsApp worker

Holds the studio's WhatsApp session and sends for the portal. It is the
studio's own service — its own key, its own session, its own disk — and it
talks to nothing but the portal.

It lives outside the Next.js app because of three things that will not change:

- **Chromium.** The session is a real WhatsApp Web login, driven by a browser.
- **A process that stays up.** The login lives in that process's memory.
- **A disk.** The saved login is on disk; without one, every restart means
  scanning the QR again.

Render's Node runtime has none of those. That is the whole reason this is a
separate container, and the only one.

## Running it

```bash
cd whatsapp-worker
WORKER_API_KEY=$(openssl rand -hex 32) docker compose up -d --build
```

`docker-compose.yml` is in this directory. Two environment variables matter:

| variable | what it is |
| --- | --- |
| `WORKER_API_KEY` | the shared secret; the portal sends it as `x-worker-key`. Required — the service refuses to start without one, because an empty key is a service that answers anybody |
| `WHATSAPP_COMPANY_ID` | defaults to `neon` |

The named volume `whatsapp-data` holds the login and the send journal. Keep it.
`docker compose down` leaves it alone; `docker compose down -v` deletes it, and
with it the linked session.

### Where to run it

Anywhere Docker runs and the portal can reach it over HTTPS — a small VPS, a
box in the studio behind a tunnel, or a container host.

**On Render:** a Docker service pointing at this directory, with a **disk
mounted at `/app/data`**. The disk is the part that decides the bill: Render's
free instances have no persistent disk and sleep when idle, so the login would
be lost on every deploy and every wake. That means a paid instance for this
service — which is the honest reason to weigh it against the Cloud transport
before committing to it.

### Pointing the portal at it

On the portal's own deployment:

```
WHATSAPP_WORKER_URL=https://<wherever this answers>
WHATSAPP_WORKER_KEY=<the same WORKER_API_KEY>
WHATSAPP_LINE_ID=main
```

## Linking the number

With it running: **Settings → Company channels → WhatsApp → Link**, and scan
the code with the phone that owns the number. The portal polls the session and
the card turns green by itself.

## The API the portal expects

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | `{ ok, companyId }` — the only route without auth |
| GET | `/lines/main/status` | the session snapshot, including the QR while linking |
| POST | `/lines/main/start` | begins linking; returns the QR or a pairing code |
| POST | `/lines/main/stop` | unlinks and forgets the login |
| POST | `/lines/main/send-text` | `{ phone, text, kind?, idempotencyKey? }` |
| POST | `/lines/main/send-media` | `{ phone, fileBase64, mimeType, filename, asDocument? }` |
| POST | `/lines/main/check-number` | `{ phone }` |

Every route except `/health` requires the header `x-worker-key`.

`main` is the studio's own number. Another segment there would be a second
line, which the library supports and the portal does not use yet.

## Two things about sending that are easy to get wrong

- **`kind` decides how a message is scored.** `reply` is uncapped,
  `notification` is spaced, and `cold` — first contact with somebody who never
  wrote in — is capped at 20 new recipients per number per day, because that is
  the axis WhatsApp actually restricts on. This worker defaults an omitted
  `kind` to `notification`, but the portal states it explicitly anyway: the
  caller is the only side that knows what a message really is, and a default is
  a guess made by something that does not.
- **An absent `idempotencyKey` is passed on as absent.** The library then
  derives one from line + recipient + text and suppresses an identical message
  for five minutes — which is what collapses a retried POST or a second tap
  while the first send is still pacing. This used to substitute
  `portal:<phone>:<Date.now()>`, which looks like a sensible default and is the
  opposite of one: a key carrying the clock is unique every call, so it matches
  nothing, and supplying it turns the deduplication off exactly where it was
  designed to work.

## What the library gives you

A thin HTTP shell around `nexora-whatsapp` (vendored in `vendor/`). The parts
worth knowing about:

- **A queue in front of every send** — pacing, retries, and one send per
  idempotency key.
- **A cold-message cap** — the protection against the number being restricted.
- **A durable journal** — messages waiting when the process dies are still
  waiting when it comes back.

## Honestly

Automating an ordinary WhatsApp account is against WhatsApp's terms and a
number can be restricted, with nobody to appeal to. The library's own README is
blunt about it: if losing the number would stop the business, put that number on
the official Cloud transport instead. The portal supports both and prefers Cloud
when it is configured.
