"use client";

import { useActionState } from "react";
import { Fingerprint, TriangleAlert } from "lucide-react";
import { syncAttendanceNow } from "@/lib/actions/operations-actions";
import type { SyncReport } from "@/lib/attendance-sync";

// The fingerprint machine, as the payroll screen sees it: one button that asks
// it what it saw today, and a plain account of what that came to.
//
// The report is drawn here rather than through describeSync, which lives beside
// the device client — importing it would pull zkteco-js, and a TCP socket, into
// the browser bundle.
//
// Nothing here reads the device on render. A page that fetched from a box on
// the wall every time somebody opened payroll would be slow when it worked and
// broken when the thing was unplugged.

export function AttendanceDeviceCard({ pairedCount, teamCount }: { pairedCount: number; teamCount: number }) {
  const [report, runSync, pending] = useActionState<SyncReport | null, FormData>(
    async () => await syncAttendanceNow(),
    null
  );

  return (
    <div className="glass mt-4 rounded-2xl p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <Fingerprint size={16} strokeWidth={1.75} className="shrink-0 text-ink/50" />
            Fingerprint device
          </p>
          <p className="mt-1 text-xs text-ink/50">
            {pairedCount === 0
              ? "Nobody is paired with a number on the device yet, so a sync would record nothing."
              : `${pairedCount} of ${teamCount} on the team are paired with a number on the device.`}{" "}
            Syncing reads today only.
          </p>
        </div>

        <form action={runSync}>
          <button
            type="submit"
            disabled={pending}
            className="rounded-full bg-ink px-5 py-2.5 text-sm font-medium text-bg transition-colors hover:bg-ink/85 disabled:opacity-50"
          >
            {pending ? "Asking the device…" : "Sync now"}
          </button>
        </form>
      </div>

      {report && <Report report={report} />}
    </div>
  );
}

function Report({ report }: { report: SyncReport }) {
  if (!report.ran) {
    const message =
      report.reason === "no-device-configured"
        ? "No device is configured on this machine (ATTENDANCE_DEVICE_IP is not set)."
        : report.reason === "unreachable"
          ? `The device did not answer: ${report.error}`
          : `The device's clock is out by ${Math.round(report.driftSeconds / 60)} minutes — it thinks it is ${report.deviceTime.slice(0, 16).replace("T", " ")}. Nothing was written, because the times it records would be wrong.`;

    return (
      <p className="mt-4 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs text-ink/70">
        <TriangleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-amber-600" />
        <span>{message}</span>
      </p>
    );
  }

  const { outcome } = report;

  return (
    <div className="mt-4 rounded-xl border border-ink/8 bg-white/50 p-3 text-xs text-ink/70">
      <p>
        Read {report.punches} {report.punches === 1 ? "punch" : "punches"} · recorded {outcome.created} new{" "}
        {outcome.created === 1 ? "day" : "days"}
        {outcome.updated > 0 && `, corrected ${outcome.updated}`}.
      </p>

      {outcome.keptManual > 0 && (
        <p className="mt-1">
          {outcome.keptManual} {outcome.keptManual === 1 ? "day was" : "days were"} left exactly as you set{" "}
          {outcome.keptManual === 1 ? "it" : "them"} by hand.
        </p>
      )}

      {outcome.skippedInactive > 0 && (
        <p className="mt-1">
          {outcome.skippedInactive} skipped — they are no longer on the team.
        </p>
      )}

      {outcome.unmapped.length > 0 && (
        <p className="mt-1 text-amber-700">
          Nobody is paired with device {outcome.unmapped.length === 1 ? "number" : "numbers"}{" "}
          {outcome.unmapped.join(", ")}, so those days were not recorded. Pair them below.
        </p>
      )}

      {report.punches > 0 && report.days === 0 && (
        <p className="mt-1">Nothing today: the device has punches, but none of them are from today.</p>
      )}
    </div>
  );
}
