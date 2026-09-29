import { prisma } from "@/lib/db";
import { isPushConfigured, sendPush, subscriptionOutcome } from "@/lib/notifications/push";
import { deviceOutcome, isApnsConfigured, sendApns } from "@/lib/notifications/apns";
import {
  DEFAULT_PREFERENCES,
  isPushEnabled,
  isTypeEnabled,
  pushPayload,
  type PreferenceFlags,
  type PushPayload,
} from "@/lib/notifications/types";
import type { NotificationType } from "@/generated/prisma/enums";

// The notification engine. Every notification in the platform is created here:
//
//   event -> preferences -> create (idempotent) -> subscriptions -> push -> log
//
// Callers describe what happened; the engine decides whether the employee
// wants to hear it, writes exactly one row per logical event, fans out to that
// employee's devices, records every attempt and retires dead subscriptions.

export type DispatchInput = {
  employeeId: string;
  type: NotificationType;
  title: string;
  message: string;
  url: string;
  dedupeKey: string;
  entryId?: string | null;
  metadata?: Record<string, unknown>;
  /** A picture for the notification where the device shows one — the sender, for a chat. */
  icon?: string;
};

export type DispatchResult = {
  created: boolean;
  notificationId?: string;
  skipped?: "inactive-employee" | "preference" | "duplicate";
  pushed?: number;
  failed?: number;
};

export async function getPreferences(employeeId: string): Promise<PreferenceFlags> {
  const stored = await prisma.notificationPreference.findUnique({ where: { employeeId } });
  if (!stored) return { ...DEFAULT_PREFERENCES };
  return {
    pushEnabled: stored.pushEnabled,
    chatMessages: stored.chatMessages,
    taskAssigned: stored.taskAssigned,
    taskUpdated: stored.taskUpdated,
    todaySchedule: stored.todaySchedule,
    tomorrowSchedule: stored.tomorrowSchedule,
    deadlineReminders: stored.deadlineReminders,
    deadlineLeadMinutes: stored.deadlineLeadMinutes,
  };
}

export async function dispatchNotification(input: DispatchInput): Promise<DispatchResult> {
  // A disabled account is silent: no rows, no devices, nothing queued for when
  // it comes back.
  const employee = await prisma.employee.findFirst({
    where: { id: input.employeeId, active: true },
    select: { id: true },
  });
  if (!employee) return { created: false, skipped: "inactive-employee" };

  const preferences = await getPreferences(input.employeeId);
  if (!isTypeEnabled(input.type, preferences)) {
    return { created: false, skipped: "preference" };
  }

  // The unique dedupeKey is what makes this idempotent: a second attempt at
  // the same logical event loses the race and stops here.
  let notification;
  try {
    notification = await prisma.notification.create({
      data: {
        employeeId: input.employeeId,
        type: input.type,
        title: input.title,
        message: input.message,
        url: input.url,
        entryId: input.entryId ?? null,
        metadata: (input.metadata ?? undefined) as never,
        dedupeKey: input.dedupeKey,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { created: false, skipped: "duplicate" };
    throw error;
  }

  await log({ notificationId: notification.id, channel: "IN_APP", status: "CREATED" });

  const delivery = await deliverPush(notification.id, input, preferences);

  return { created: true, notificationId: notification.id, ...delivery };
}

async function deliverPush(
  notificationId: string,
  input: DispatchInput,
  preferences: PreferenceFlags
): Promise<{ pushed: number; failed: number }> {
  if (!isPushEnabled(input.type, preferences)) {
    return { pushed: 0, failed: 0 };
  }

  const payload = pushPayload({
    title: input.title,
    message: input.message,
    url: input.url,
    type: input.type,
    notificationId,
    icon: input.icon,
  });

  // Two transports, one notification. An employee with a phone on the Home
  // Screen and the same person with the staff app installed is one person who
  // asked to be told once — but the two devices are genuinely different
  // devices, and a studio mid-way through moving to the app has people on
  // either side of it. Sending to both is what makes the move something nobody
  // has to be switched over on a particular day.
  //
  // Neither transport can stop the other: each is awaited separately and each
  // decides for itself whether it is configured at all.
  const web = await deliverWebPush(notificationId, input.employeeId, payload);
  const apple = await deliverApns(notificationId, input.employeeId, payload);

  const pushed = web.pushed + apple.pushed;
  const failed = web.failed + apple.failed;

  if (pushed > 0) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { deliveredAt: new Date() },
    });
  }

  return { pushed, failed };
}

async function deliverWebPush(
  notificationId: string,
  employeeId: string,
  payload: PushPayload
): Promise<{ pushed: number; failed: number }> {
  if (!(await isPushConfigured())) return { pushed: 0, failed: 0 };

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { employeeId, active: true },
  });
  if (subscriptions.length === 0) return { pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;

  // Every device belonging to this employee gets the same notification, and
  // one dead device never stops the others.
  for (const subscription of subscriptions) {
    const result = await sendPush(
      { endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth },
      payload
    );

    // One policy decides what a result means for the device, whether it
    // succeeded, failed once, or is gone for good.
    const outcome = subscriptionOutcome(result, subscription.failureCount);

    if (result.ok) {
      pushed++;
    } else {
      failed++;
    }

    await log({
      notificationId,
      subscriptionId: subscription.id,
      channel: "WEB_PUSH",
      status: outcome.status,
      detail: result.ok
        ? `HTTP ${result.statusCode}`
        : `${result.statusCode ?? "no status"}: ${result.error}`.slice(0, 500),
    });

    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: {
        active: outcome.active,
        failureCount: outcome.failureCount,
        lastUsedAt: result.ok ? new Date() : subscription.lastUsedAt,
      },
    });
  }

  return { pushed, failed };
}

async function deliverApns(
  notificationId: string,
  employeeId: string,
  payload: PushPayload
): Promise<{ pushed: number; failed: number }> {
  // Not configured is an ordinary answer, not a fault: the studio ran on web
  // push alone for months and still does wherever the app is not installed.
  if (!isApnsConfigured()) return { pushed: 0, failed: 0 };

  const devices = await prisma.deviceToken.findMany({ where: { employeeId, active: true } });
  if (devices.length === 0) return { pushed: 0, failed: 0 };

  let pushed = 0;
  let failed = 0;

  for (const device of devices) {
    const result = await sendApns(
      { token: device.token, bundleId: device.bundleId, sandbox: device.sandbox },
      payload
    );

    const outcome = deviceOutcome(result, device.failureCount);

    if (result.ok) {
      pushed++;
    } else {
      failed++;
    }

    await log({
      notificationId,
      deviceTokenId: device.id,
      channel: "APNS",
      status: outcome.status,
      detail: result.ok
        ? `HTTP ${result.statusCode}`
        : `${result.statusCode ?? "no status"}: ${result.error}`.slice(0, 500),
    });

    await prisma.deviceToken.update({
      where: { id: device.id },
      data: {
        active: outcome.active,
        failureCount: outcome.failureCount,
        lastUsedAt: result.ok ? new Date() : device.lastUsedAt,
      },
    });
  }

  return { pushed, failed };
}

async function log(entry: {
  notificationId: string;
  subscriptionId?: string | null;
  deviceTokenId?: string | null;
  channel: "IN_APP" | "WEB_PUSH" | "APNS";
  status: "CREATED" | "SENT" | "FAILED" | "EXPIRED";
  detail?: string | null;
}) {
  // Logging must never be the reason a notification fails.
  await prisma.notificationDelivery
    .create({
      data: {
        notificationId: entry.notificationId,
        subscriptionId: entry.subscriptionId ?? null,
        deviceTokenId: entry.deviceTokenId ?? null,
        channel: entry.channel,
        status: entry.status,
        detail: entry.detail ?? null,
      },
    })
    .catch(() => {});
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
