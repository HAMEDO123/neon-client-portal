# NEON WhatsApp worker

Holds the studio's WhatsApp session and sends for the portal. It exists as a
separate service because of three things that will not change:

- **Chromium.** The session is a real WhatsApp Web login, driven by a browser.
- **A process that stays up.** The login lives in that process's memory.
- **A disk.** The saved login is on disk; without one, every restart means
  scanning the QR again.

A Next.js app on Render's Node runtime has none of those, which is why the
portal only talks to this over HTTP.

## What the portal expects

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

`main` is the company's own number. Another segment there would be a second
line, which the library supports and the portal does not use yet.

## Running it

Two environment variables matter:

```
WORKER_API_KEY        the shared secret; the portal sends it as x-worker-key
WHATSAPP_COMPANY_ID   defaults to "neon"
```

### Beside the Nixora stack (cheapest — it already has Docker)

```yaml
# docker-compose.yml
  neon-whatsapp:
    build: ./neon-client-portal/whatsapp-worker
    restart: unless-stopped
    environment:
      - WORKER_API_KEY=${NEON_WORKER_API_KEY}
      - WHATSAPP_COMPANY_ID=neon
    volumes:
      - neon-whatsapp-data:/app/data   # the login and the send journal
    ports:
      - "4100:4100"

volumes:
  neon-whatsapp-data:
```

Expose it to the portal through the tunnel that is already there, then set on
Render:

```
WHATSAPP_WORKER_URL=https://<wherever it answers>
WHATSAPP_WORKER_KEY=<the same WORKER_API_KEY>
WHATSAPP_LINE_ID=main
```

### On Render

A **Docker** service pointing at this directory, with a **disk mounted at
`/app/data`**. The disk is the part that matters: Render's free instances have
no persistent disk, so the login would be lost on every deploy and sleep —
which means a paid instance for this service.

## Linking

Deploy it, then in the portal: **Settings → Company channels → WhatsApp →
Link**, and scan the code with the phone that owns the number. The portal
watches the session and the card turns green by itself.

## What the library gives you

This is a thin HTTP shell around `nexora-whatsapp` (vendored in `vendor/`).
The parts worth knowing about:

- **A queue in front of every send** — pacing, retries, and one send per
  idempotency key, so a double-tap or a retry cannot send twice.
- **A cold-message cap** — 20 first-contact messages per number per day, which
  is the protection against the number being restricted. The portal sends
  client updates as `notification`, not `cold`.
- **A durable journal** — messages waiting when the process dies are still
  waiting when it comes back.

Automating an ordinary WhatsApp account is against WhatsApp's terms and a
number can be restricted. The library's own README is blunt about it: if
losing the number would stop the business, put that number on the official
Cloud API instead — the portal supports both and prefers Cloud when it is
configured.
