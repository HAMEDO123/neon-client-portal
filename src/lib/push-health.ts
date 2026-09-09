import { prisma } from "@/lib/db";
import { isPushConfigured } from "@/lib/notifications/push";
import { getVapidKeys } from "@/lib/notifications/vapid";

// Why push is or is not arriving.
//
// "Notifications don't work" has four quite different causes — no keys on the
// server, no device subscribed, a device the browser has since dropped, or a
// send that failed — and they need four different fixes. This gathers the facts
// so the answer is a fact rather than a guess.

export type PushHealth = {
  configured: boolean;
  /** Where the signing keys came from, so the card can say so plainly. */
  source: "environment" | "database" | null;
  devices: { employeeId: string; name: string; active: number; retired: number; lastUsedAt: Date | null }[];
  activeTotal: number;
  recent: {
    at: Date;
    status: string;
    channel: string;
    detail: string | null;
    employee: string | null;
  }[];
};

export async function getPushHealth(): Promise<PushHealth> {
  const keys = await getVapidKeys();
  const configured = await isPushConfigured();

  // Sequential, like the rest of the multi-query reads here.
  const employees = await prisma.employee.findMany({
    where: { accessRole: "EMPLOYEE", active: true },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      subscriptions: { select: { active: true, lastUsedAt: true } },
    },
  });

  const devices = employees.map((employee) => ({
    employeeId: employee.id,
    name: employee.name,
    active: employee.subscriptions.filter((row) => row.active).length,
    retired: employee.subscriptions.filter((row) => !row.active).length,
    lastUsedAt: employee.subscriptions
      .map((row) => row.lastUsedAt)
      .filter((value): value is Date => value != null)
      .sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
  }));

  const deliveries = await prisma.notificationDelivery.findMany({
    where: { channel: "WEB_PUSH" },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: {
      createdAt: true,
      status: true,
      channel: true,
      detail: true,
      notification: { select: { employee: { select: { name: true } } } },
    },
  });

  return {
    configured,
    source: keys?.source ?? null,
    devices,
    activeTotal: devices.reduce((sum, row) => sum + row.active, 0),
    recent: deliveries.map((row) => ({
      at: row.createdAt,
      status: row.status,
      channel: row.channel,
      detail: row.detail,
      employee: row.notification?.employee?.name ?? null,
    })),
  };
}
