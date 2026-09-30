# Ringing a phone for a call — what the server sends

Written for whoever builds the CallKit side on the Mac. The server half is
live; this is the contract it keeps.

## Register two tokens, not one

`POST /api/mobile/devices` (bearer token), **twice per phone**:

```json
{ "token": "<apns token>",   "bundleId": "com.neonjo.staff", "kind": "alert", "sandbox": false }
{ "token": "<pushkit token>", "bundleId": "com.neonjo.staff", "kind": "voip",  "sandbox": false }
```

They are different credentials from different Apple services and are stored as
two rows. `kind` defaults to `alert` when absent, so an app that does not know
about VoIP keeps working exactly as it does now.

`sandbox: true` for a development build — it selects Apple's sandbox host, and
a token from one is rejected by the other.

## What arrives

A VoIP push, on topic `com.neonjo.staff.voip`, `apns-push-type: voip`,
priority 10, collapsed on the call. **No `aps` payload at all** — iOS draws
nothing, the app does. The body is:

```json
{
  "event": "incoming",
  "callId": "cme…",
  "kind": "AUDIO",
  "from": "Wael",
  "fromKey": "cme…"
}
```

and when it is over:

```json
{ "event": "ended", "callId": "cme…", "kind": "AUDIO", "from": "Wael", "fromKey": "cme…", "reason": "completed" }
```

`reason` is `completed`, `missed` or `declined`.

There is deliberately **no conversation** in it. A conversation's slug is
written from the reader's own side — in a chat between two people it is "the
other one" — so one slug sent to several phones is wrong for somebody by
construction. Use `callId`; the rest comes from the calls stream once awake.

## The obligation

**Report every VoIP push to CallKit immediately, including `ended`.** iOS kills
an app that accepts one and reports no call. On `ended`, report the call and
end it — a phone woken for a call that is already over still has to close it.

A call rings for 45 seconds (`RING_MS`) before the server sweeps it as missed,
so CallKit's own timeout should not be shorter.

## What already works without any of this

An ordinary banner — "Incoming call" — already goes to every `alert` token when
a call starts, through the notification engine. A phone with no VoIP token
keeps getting exactly that. What it cannot do is ring; that is the whole reason
this exists.

## Answering

Answering from CallKit still has to join the call: `POST /api/mobile/calls`
with `{ "action": "join", "callId": "…" }`, which returns the ICE servers.
TURN is configured, so a call connects on mobile data.
