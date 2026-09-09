import { prisma } from "@/lib/db";
import { isPushConfigured, sendPush, subscriptionOutcome } from "@/lib/notifications/push";
import {
  DEFAULT_PREFERENCES,
  isPushEnabled,
  isTypeEnabled,
  pushPayload,
  type PreferenceFlags,
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

  await log(notification.id, null, "IN_APP", "CREATED", null);

  const delivery = await deliverPush(notification.id, input, preferences);

  return { created: true, notificationId: notification.id, ...delivery };
}

async function deliverPush(
  notificationId: string,
  input: DispatchInput,
  preferences: PreferenceFlags
): Promise<{ pushed: number; failed: number }> {
  if (!isPushEnabled(input.type, preferences) || !(await isPushConfigured())) {
    return { pushed: 0, failed: 0 };
  }

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { employeeId: input.employeeId, active: true },
  });
  if (subscriptions.length === 0) return { pushed: 0, failed: 0 };

  const payload = pushPayload({
    title: input.title,
    message: input.message,
    url: input.url,
    type: input.type,
    notificationId,
  });

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

    await log(
      notificationId,
      subscription.id,
      "WEB_PUSH",
      outcome.status,
      result.ok
        ? `HTTP ${result.statusCode}`
        : `${result.statusCode ?? "no status"}: ${result.error}`.slice(0, 500)
    );

    await prisma.pushSubscription.update({
      where: { id: subscription.id },
      data: {
        active: outcome.active,
        failureCount: outcome.failureCount,
        lastUsedAt: result.ok ? new Date() : subscription.lastUsedAt,
      },
    });
  }

  if (pushed > 0) {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { deliveredAt: new Date() },
    });
  }

  return { pushed, failed };
}

async function log(
  notificationId: string,
  subscriptionId: string | null,
  channel: "IN_APP" | "WEB_PUSH",
  status: "CREATED" | "SENT" | "FAILED" | "EXPIRED",
  detail: string | null
) {
  // Logging must never be the reason a notification fails.
  await prisma.notificationDelivery
    .create({ data: { notificationId, subscriptionId, channel, status, detail } })
    .catch(() => {});
}

function isUniqueViolation(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002";
}
