import { NextResponse } from "next/server";
import { runDeadlineReminders, runScheduleNotifier, runStageReminders } from "@/lib/notifications/events";
import { runFollowUps } from "@/lib/notifications/follow-up-events";
import { runRules } from "@/lib/notifications/automation-events";
import { runMeetingReminders } from "@/lib/notifications/meeting-events";
import { runSiteVisitReminders } from "@/lib/notifications/site-visit-events";
import { syncAttendance } from "@/lib/attendance-sync";
import { runClockReminders } from "@/lib/notifications/clock-events";
import { runLocationKeeper } from "@/lib/notifications/location-keeper";
import { getTimezone, setSetting } from "@/lib/settings";
import { hourIn } from "@/lib/time";
import { cronStampKey, cronStampValue } from "@/lib/status";

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

  // Every run leaves a stamp: when it started, whether it finished, how long
  // it took. It is the only way the manager's status screen can tell that
  // neon-scheduler and neon-meeting-scheduler are alive — the site is not
  // given the Docker socket, so it reads their health off what they do. The
  // full pass and each forced job keep their own stamp, so the meeting pass
  // calling every minute cannot hide a ten-minute pass that has stopped.
  // Written after the run, and never allowed to fail it.
  const startedAt = new Date();
  const stampKey = cronStampKey(new URL(request.url).searchParams.get("job"));
  let finished = false;
  try {
    const response = await run(request);
    finished = true;
    return response;
  } finally {
    if (stampKey) {
      await setSetting(stampKey, cronStampValue(startedAt, finished)).catch((error) => {
        console.error("[cron] could not record the run", error);
      });
    }
  }
}

async function run(request: Request) {
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
    ran.followUps = await runFollowUps(new Date(), timezone);
  }

  // The studio's own rules, on the same footing as the follow-ups: considered
  // every run, each one keyed to the rule, the person and the day so overlapping
  // runs say it once. With the switch off — which is how it ships — this looks
  // at the day and says nothing.
  if (forced === "rules" || !forced) {
    ran.rules = await runRules();
  }

  // Meetings set from a chat: the warning before one starts, and the word that
  // it has. Considered on every run like the follow-ups, and called on its own
  // every minute by the meeting-scheduler — a meeting at 2:30 announced at 2:38
  // is worth very little. Each notification carries the meeting's start in its
  // key, so overlapping runs tell somebody once.
  if (forced === "meetings" || !forced) {
    ran.meetings = await runMeetingReminders(new Date(), timezone);
  }

  // The reminder the day before a site visit, and the job each visit has among
  // the tasks. Considered on every run: a reminder is keyed to the visit's own
  // time, so overlapping runs say it once. It reports rather than throws, so a
  // failure here cannot take the rest of the pass down with it.
  if (forced === "visits" || !forced) {
    ran.visits = await runSiteVisitReminders(new Date(), timezone).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  // What the fingerprint device saw. Considered on every run, like the
  // follow-ups: it hands over its whole log each time and every day lands on
  // the same (employee, day) row, so repeating a run writes the same numbers
  // rather than doubling anything. It reports rather than throws — a device
  // that is unplugged must not take the rest of this pass down with it.
  if (forced === "attendance" || !forced) {
    ran.attendance = await syncAttendance();
  }

  // "Clock in" / "Clock out" on the fingerprint device, every two minutes in
  // their windows (lib/clock-reminders.ts). Called every minute by the meeting
  // scheduler; outside the windows it returns without touching the device.
  if (forced === "clock" || !forced) {
    ran.clock = await runClockReminders(new Date()).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
  }

  // Where the team is (lib/staff-location.ts): wakes the phones that have gone
  // quiet for ten minutes while the working window is open, and wipes every
  // position whenever it is not. Called every minute by the meeting scheduler,
  // so a position never outlives the day by more than a minute.
  if (forced === "location" || !forced) {
    ran.location = await runLocationKeeper(new Date()).catch((error) => ({
      error: error instanceof Error ? error.message : String(error),
    }));
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
