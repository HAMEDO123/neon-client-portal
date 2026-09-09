# nexora-whatsapp

A WhatsApp number run properly: sessions that survive WhatsApp Web's habits, and a send queue that will not get the number restricted.

Extracted from the NEXORA platform, where it runs five numbers in production. Every rule in here was written after something went wrong.

## Install

```bash
npm install ./nexora-whatsapp
```

Chromium is not bundled. On a server, install it and point at it:

```bash
apt-get install -y chromium
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

## Use

```ts
import { createWhatsApp } from "nexora-whatsapp";

const wa = createWhatsApp({
  journalPath: "./data/whatsapp-outbox.json",
  onStatus: (line, snapshot) => {
    if (snapshot.qrDataUrl) console.log("scan this:", snapshot.qrDataUrl);
    if (snapshot.status === "connected") console.log("linked:", snapshot.phoneNumber);
  },
  onMessage: async (line, message) => {
    wa.send({
      lineKey: `${line.companyId}`,
      companyId: line.companyId,
      to: message.from,
      text: `You said: ${message.body}`,
      kind: "reply",
      idempotencyKey: `reply:${message.from}:${Date.now()}`,
    });
  },
});

await wa.resume();                          // bring saved logins back up
await wa.link({ companyId: "acme" });       // QR — watch onStatus
await wa.link({ companyId: "acme" }, "962791234567"); // or a pairing code
```

## The one thing to get right

`kind` is the whole safety model.

| kind | what it means | capped |
| --- | --- | --- |
| `reply` | answering someone who wrote to you | no |
| `notification` | an update they expect — an order, a booking | per hour |
| `cold` | the first message to someone who never wrote to you | **20 per number per day** |

Cold outreach is what gets numbers banned. The cap is the protection; raise it with `WHATSAPP_COLD_DAILY_CAP` only if you are willing to lose the number.

## What you get that a bare `whatsapp-web.js` does not

**A queue in front of every send.** Pacing with a typing delay, retries with backoff, one send per idempotency key (a retried action or a double-tap collapses into the send that already happened), and a durable journal so messages waiting when the process dies are still waiting when it comes back.

**A reachability memory.** Asking whether a number is on WhatsApp is scored separately from messaging, so the answer is memoised per number — thirty days for a no, twelve hours for a yes — and skipped entirely for replies. A lookup that cannot be answered reads as "go ahead", never as "no".

**A memory of numbers that permanently fail.** The next message to a dead number never reaches a transport at all.

**Content-free events are ignored.** WhatsApp delivers events carrying no words — most visibly under its `@lid` addressing, where the sender has no phone number either. Answering one sends an unprompted message to somebody who never wrote to you. In one production store this had produced 151 phantom conversations and 175 wasted replies before it was caught.

**Sessions that come back.** Saved logins resume on boot, a browser that never signals ready is relaunched, QR refreshes are capped so an abandoned linking attempt cannot cycle forever, and idle sessions are evicted before they eat the disk.

**The official Cloud API alongside it**, in `cloud-api.ts`, for numbers you cannot afford to lose.

## Tuning

Every limit is an environment variable, and the defaults are the ones running in production:

| variable | default | what it bounds |
| --- | --- | --- |
| `WHATSAPP_COLD_DAILY_CAP` | 20 | new cold recipients per number per day |
| `WHATSAPP_MAX_SESSIONS` | — | concurrent browser sessions |
| `WHATSAPP_MAX_LINES_PER_COMPANY` | — | numbers per tenant |
| `WHATSAPP_MAX_QR_REFRESHES` | — | QR re-issues before an attempt is abandoned |
| `WHATSAPP_READY_TIMEOUT_MS` | — | wait for a browser to signal ready before relaunching |
| `WHATSAPP_IDLE_EVICT_MINUTES` | — | when an idle session is closed |
| `WHATSAPP_LOOKUP_BUDGET_PER_HOUR` | 120 | contact-existence lookups per number |
| `PUPPETEER_EXECUTABLE_PATH` | — | your Chromium |

## Honestly

`whatsapp-web.js` drives WhatsApp Web in a browser. It is not affiliated with or endorsed by WhatsApp, and automating an ordinary account is against WhatsApp's terms. A number can be restricted or banned, and there is nobody to appeal to.

This package makes that outcome much less likely. It cannot make it impossible. If losing a number would stop your business, put that number on the official Cloud API and use this for the rest.

## Licence

Apache-2.0, matching `whatsapp-web.js` and `puppeteer`.
