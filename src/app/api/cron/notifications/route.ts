import { NextResponse } from "next/server";
import { runDeadlineReminders, runScheduleNotifier, runStageReminders } from "@/lib/notifications/events";
import { runFollowUps } from "@/lib/notifications/follow-up-events";
import { runRules } from "@/lib/notifications/automation-events";
import { getTimezone } from "@/lib/settings";
import { hourIn } from "@/lib/time";

// The scheduled entry point. An external scheduler calls this every hour and
// the endpoint decides whether it is time — that way the daily run follows the
// company timezone rather than the scheduler's UTC clock, and a timezone
// change needs no redeploy.
//
// Every job it can start is idempotent, so an extra call is harmless.

export const dynamic = "force-dynamic";

// 4:00 PM, per the spec, in the configured timezone.
const TOMORROW_SUMMARY_HOUR = 16;
const TODAY_SUMMARY_HOUR = 8;

function authorised(request: Request) {
  const secret = process.env.CRON_SECRET;
  // Without a configured secret the endpoint stays shut rather than open.
  if (!secret) return false;

  const header = request.headers.get("authorization") ?? "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
  const query = new URL(request.url).searchParams.get("key");

  return bearer === secret || query === secret;
}

async function handle(request: Request) {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const timezone = await getTimezone();
  const hour = hourIn(timezone);

  // `job` forces one specific run, for testing and for manual re-runs.
  const forced = url.searchParams.get("job");
  const ran: Record<string, unknown> = {};

  if (forced === "tomorrow" || (!forced && hour === TOMORROW_SUMMARY_HOUR)) {
    ran.tomorrow = await runScheduleNotifier("tomorrow");
  }

  if (forced === "today" || (!forced && hour === TODAY_SUMMARY_HOUR)) {
    ran.today = await runScheduleNotifier("today");
  }

  // Deadline reminders are lead-time based, so they are considered on every
  // run rather than at a fixed hour.
  if (forced === "deadlines" || !forced) {
    ran.deadlines = await runDeadlineReminders();
  }

  // The day's own follow-ups are the reason this endpoint is now called every
  // few minutes rather than hourly: a question due at 11:30 is worth little at
  // 12:05. Every one carries its own dedupe key, so overlapping runs ask once.
  if (forced === "followups" || !forced) {
    ran.followUps = await runFollowUps();
  }

  // The studio's own rules, on the same footing as the follow-ups: considered
  // every run, each one keyed to the rule, the person and the day so overlapping
  // runs say it once. With the switch off — which is how it ships — this looks
  // at the day and says nothing.
  if (forced === "rules" || !forced) {
    ran.rules = await runRules();
  }

  // Chasing against the stage periods is a daily conversation, not an hourly
  // one, so it goes out with the morning summary.
  if (forced === "stages" || (!forced && hour === TODAY_SUMMARY_HOUR)) {
    ran.stages = await runStageReminders();
  }

  return NextResponse.json({
    ok: true,
    timezone,
    localHour: hour,
    forced: forced ?? null,
    ran,
  });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
