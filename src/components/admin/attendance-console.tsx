"use client";

import { useActionState } from "react";
import { RefreshCw, TriangleAlert, Clock3 } from "lucide-react";
import { setDeviceClockNow, syncAttendanceNow, type ClockResult } from "@/lib/actions/operations-actions";
import type { SyncReport } from "@/lib/attendance-sync";

// The two things a manager can actually do to the machine from their desk: ask
// it what it saw, and put its clock right.
//
// Both report in words rather than leaving the screen unchanged — a button that
// looks the same afterwards is a button nobody trusts, and the answers here
// ("nothing today", "nobody is paired with number 2") are the whole reason to
// press them.

export function AttendanceConsole() {
  const [sync, runSync, syncing] = useActionState<SyncReport | null, FormData>(
    async () => await syncAttendanceNow(),
    null
  );
  const [clock, runClock, settingClock] = useActionState<ClockResult | null, FormData>(
    async () => await setDeviceClockNow(),
    null
  );

  return (
    <div className="mt-4 rounded-2xl border border-warm-line bg-card p-5">
      <div className="flex flex-wrap gap-2">
        <form action={runSync}>
          <button
            type="submit"
            disabled={syncing}
            className="inline-flex items-center gap-2 rounded-full bg-clay px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-clay-deep disabled:opacity-50"
          >
            <RefreshCw size={15} strokeWidth={2} className={syncing ? "animate-spin" : undefined} />
            {syncing ? "Asking the device…" : "Sync today"}
          </button>
        </form>

        <form action={runClock}>
          <button
            type="submit"
            disabled={settingClock}
            className="inline-flex items-center gap-2 rounded-full border border-warm-line px-5 py-2.5 text-sm font-medium text-bark transition-colors hover:bg-clay-soft disabled:opacity-50"
          >
            <Clock3 size={15} strokeWidth={2} />
            {settingClock ? "Setting…" : "Set its clock"}
          </button>
        </form>
      </div>

      {clock && <ClockLine result={clock} />}
      {sync && <SyncLine report={sync} />}
    </div>
  );
}

function Note({ tone, children }: { tone: "plain" | "warn"; children: React.ReactNode }) {
  return (
    <p
      className={
        tone === "warn"
          ? "mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs text-bark/75"
          : "mt-3 rounded-xl border border-warm-line bg-paper-soft p-3 text-xs text-bark/70"
      }
    >
      {tone === "warn" && <TriangleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-amber-600" />}
      <span>{children}</span>
    </p>
  );
}

function ClockLine({ result }: { result: ClockResult }) {
  if (!result.ok) {
    return (
      <Note tone="warn">
        {result.reason === "no-device"
          ? "No device is configured on this machine."
          : `Could not set the clock: ${result.error}`}
      </Note>
    );
  }

  return (
    <Note tone="plain">
      Clock set. The device now reads {result.wallClock}
      {Math.abs(result.driftSeconds) > 60
        ? ` — still ${result.driftSeconds}s out, which usually means its backup battery is dead.`
        : "."}
    </Note>
  );
}

function SyncLine({ report }: { report: SyncReport }) {
  if (!report.ran) {
    if (report.reason === "no-device-configured") return <Note tone="warn">No device is configured.</Note>;
    if (report.reason === "unreachable") return <Note tone="warn">The device did not answer: {report.error}</Note>;
    return (
      <Note tone="warn">
        Nothing written: the device reads {report.deviceTime}, which is {Math.round(report.driftSeconds / 60)} minutes
        out. Set its clock first, or the times it records are meaningless.
      </Note>
    );
  }

  const { outcome } = report;

  return (
    <Note tone="plain">
      Read {report.punches} {report.punches === 1 ? "punch" : "punches"} · recorded {outcome.created} new{" "}
      {outcome.created === 1 ? "day" : "days"}
      {outcome.updated > 0 && `, corrected ${outcome.updated}`}.
      {outcome.keptManual > 0 && ` ${outcome.keptManual} left exactly as you set them by hand.`}
      {outcome.skippedInactive > 0 && ` ${outcome.skippedInactive} skipped — no longer on the team.`}
      {outcome.unmapped.length > 0 && ` Nobody is paired with ${outcome.unmapped.join(", ")}.`}
      {report.punches > 0 && report.days === 0 && " Nothing from today."}
    </Note>
  );
}
