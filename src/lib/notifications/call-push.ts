import { prisma } from "@/lib/db";
import { isApnsConfigured, isGone, sendCallPush, type CallPushPayload } from "@/lib/notifications/apns";

// Making a phone ring for a call.
//
// Until this, a call reached somebody only while their app was open and
// holding the calls stream. Backgrounded or locked, the phone learned nothing
// and the call was swept as missed forty-five seconds later — which is not a
// missed call, it is a call that was never delivered.
//
// Two ways in, and which one a device gets depends on what it registered:
//
// This is the VoIP half only. The ordinary banner — "Incoming call" — already
// goes out through the notification engine when a call starts, to every ALERT
// token; a phone with no VoIP token keeps getting exactly that. What it could
// never do is ring.
//
// Nothing here throws into a call. A call that is happening must not fail to
// start because a phone could not be reached.

/** Who to ring, and what to tell them. */
export type RingInput = {
  callId: string;
  kind: string;
  /** The caller, for the lock screen. */
  from: string;
  fromKey: string;
  /** Member keys to ring — "admin" is skipped, having no Employee row. */
  memberKeys: string[];
};

/**
 * Rings every phone belonging to the people asked into a call.
 *
 * Never awaited by the caller: starting a call must not wait on Apple, and a
 * push that fails must not undo a call that is already ringing on the web.
 */
export async function ringPhones(input: RingInput): Promise<void> {
  await push(input, { event: "incoming" });
}

/**
 * Tells those phones the call is over.
 *
 * Not politeness — an obligation. iOS kills an app that accepts a VoIP push
 * and reports no call, so a phone woken for a call that has since ended must
 * be told, and CallKit must be allowed to close it. It is also what stops a
 * pocket ringing for forty-five seconds after somebody hung up.
 */
export async function stopRinging(input: RingInput, reason: string): Promise<void> {
  await push(input, { event: "ended", reason });
}

async function push(input: RingInput, extra: { event: "incoming" | "ended"; reason?: string }): Promise<void> {
  if (!isApnsConfigured()) return;

  // The manager has no Employee row, so no device rows either — they are
  // reached the way they always have been, through the web.
  const employeeIds = input.memberKeys.filter((key) => key !== "admin" && key !== input.fromKey);
  if (employeeIds.length === 0) return;

  const devices = await prisma.deviceToken
    .findMany({
      where: { employeeId: { in: employeeIds }, active: true, kind: "VOIP" },
      select: { id: true, token: true, bundleId: true, sandbox: true },
    })
    .catch(() => []);
  if (devices.length === 0) return;

  const payload: CallPushPayload = {
    event: extra.event,
    callId: input.callId,
    kind: input.kind,
    from: input.from,
    fromKey: input.fromKey,
    ...(extra.reason ? { reason: extra.reason } : {}),
  };

  for (const device of devices) {
    try {
      const result = await sendCallPush(
        { token: device.token, bundleId: device.bundleId, sandbox: device.sandbox },
        payload
      );
      await retire(device.id, result);
    } catch {
      // One unreachable phone is not a reason to stop ringing the others.
    }
  }
}

/** Retires a token Apple says is dead, so it is not tried for ever. */
async function retire(id: string, result: Awaited<ReturnType<typeof sendCallPush>>): Promise<void> {
  if (result.ok) {
    await prisma.deviceToken.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => null);
    return;
  }

  if (isGone(result.statusCode, result.error)) {
    await prisma.deviceToken.update({ where: { id }, data: { active: false } }).catch(() => null);
    return;
  }

  await prisma.deviceToken
    .update({ where: { id }, data: { failureCount: { increment: 1 } } })
    .catch(() => null);
}
