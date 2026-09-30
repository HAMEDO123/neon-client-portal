import { prisma } from "@/lib/db";
import { getPlanningNotes, getTimezone, getWorkHours } from "@/lib/settings";
import { capacityMinutes, minutesOf, spanMinutes, timeOf, type WorkHours } from "@/lib/work-hours";
import { isAiConfigured } from "@/lib/ai/client";
import { managerEmployeeId } from "@/lib/manager-account";
import { activeTransport, checkWhatsAppConnection } from "@/lib/whatsapp";
import { getPushHealth, type PushHealth } from "@/lib/push-health";
import { automationOn, runRules, type RuleRun } from "@/lib/notifications/automation-events";
import type { Rule } from "@/lib/automation";
import { facesFor, type Faces } from "@/lib/faces";

// Gathers what admin/(dashboard)/settings reads, for the phone's registry
// entries — every field is read through the same lib functions the page
// calls. The delivery process (process sections, stage periods, what each
// kind of work needs) is the tasks area's; this deliberately leaves it out.

export const TIMEZONES = [
  "Asia/Amman",
  "Asia/Riyadh",
  "Asia/Dubai",
  "Africa/Cairo",
  "Europe/Istanbul",
  "Europe/London",
  "UTC",
];

export type OpsSettings = {
  timezone: string;
  timezoneOptions: string[];
  planningNotes: string;
  workHours: WorkHours;
  dayLengthMinutes: number;
  capacityMinutes: number;
  onTimeUntil: string;
  automationRules: Rule[];
  automationSwitchedOn: boolean;
  pushHealth: PushHealth;
  /** Employee id → photo, for the people in `pushHealth.devices` who have one. */
  faces: Faces;
  managerPaired: boolean;
  managerDevices: number;
  whatsapp: {
    transport: "none" | "cloud" | "worker";
    connected: boolean;
    detail: string | null;
    number: string | null;
  };
  aiConfigured: boolean;
};

function toRule(row: {
  id: string;
  name: string;
  trigger: string;
  atLeast: number;
  action: string;
  recipient: string;
  graceMinutes: number;
  cooldownMinutes: number;
  escalateAfterMinutes: number | null;
  enabled: boolean;
}): Rule {
  return row as unknown as Rule;
}

export async function opsSettings(): Promise<OpsSettings> {
  const timezone = await getTimezone();
  const planningNotes = await getPlanningNotes();
  const workHours = await getWorkHours();
  const transport = activeTransport();
  const connection = transport === "none" ? null : await checkWhatsAppConnection();

  const pushHealth = await getPushHealth();
  const managerId = await managerEmployeeId();
  const managerDevices = managerId
    ? await prisma.pushSubscription.count({ where: { employeeId: managerId, active: true } })
    : 0;

  const rules = await prisma.automationRule.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
  const automationSwitchedOn = await automationOn();

  return {
    timezone,
    timezoneOptions: [...new Set([timezone, ...TIMEZONES])],
    planningNotes,
    workHours,
    dayLengthMinutes: spanMinutes(workHours),
    capacityMinutes: capacityMinutes(workHours),
    onTimeUntil: timeOf((minutesOf(workHours.start) ?? 0) + workHours.graceMinutes),
    automationRules: rules.map(toRule),
    automationSwitchedOn,
    pushHealth,
    // Faces beside the push list rather than inside getPushHealth, which the
    // website's settings page reads and draws no faces from.
    faces: await facesFor(pushHealth.devices.map((device) => device.employeeId)),
    managerPaired: Boolean(managerId),
    managerDevices,
    whatsapp: {
      transport,
      connected: Boolean(connection?.ok),
      detail: connection?.detail ?? (transport === "none" ? "Not configured" : null),
      number: connection?.number ?? null,
    },
    aiConfigured: isAiConfigured(),
  };
}

export async function opsAutomationPreview(): Promise<RuleRun> {
  return runRules(new Date(), { preview: true });
}
