import { BellRing, CircleAlert, CircleCheck, Smartphone } from "lucide-react";
import type { PushHealth } from "@/lib/push-health";
import { sendTestPush } from "@/lib/actions/push-test-actions";
import { formatDayIn, formatTimeIn } from "@/lib/time";
import { cn } from "@/lib/utils";

// What is actually stopping a notification from arriving.
//
// Four things have to be true, and each fails differently: keys on the server,
// permission granted on the phone, a device subscribed, and a send that
// succeeded. Each line here answers one of them, so "it doesn't work" turns
// into something with a fix attached.

export function PushHealthCard({ health, timezone }: { health: PushHealth; timezone: string }) {
  const withDevices = health.devices.filter((device) => device.active > 0);
  const withoutDevices = health.devices.filter((device) => device.active === 0);

  return (
    <section>
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <BellRing size={15} strokeWidth={2} />
        Push notifications
      </h2>
      <p className="mt-1 text-sm text-ink/50">
        In-app notifications always work. Push — the ones that arrive on a phone with the app closed — needs all of
        the below.
      </p>

      <div className="mt-4 flex flex-col gap-2">
        <Check
          ok={health.configured}
          label="Server keys"
          okText="VAPID keys are set on this server."
          badText={
            health.missing.length > 0
              ? `Missing ${health.missing.join(" and ")} in the environment. Until they are set, nothing is sent to any device.`
              : "The keys are present but were rejected as invalid."
          }
        />

        <Check
          ok={health.activeTotal > 0}
          label="Subscribed devices"
          okText={`${health.activeTotal} ${health.activeTotal === 1 ? "device is" : "devices are"} subscribed.`}
          badText="Nobody has turned push on yet. Each employee does it once, from Profile in their portal — and on an iPhone, only after adding the app to the Home Screen."
        />
      </div>

      {health.devices.length > 0 && (
        <ul className="mt-4 flex flex-col gap-1.5">
          {[...withDevices, ...withoutDevices].map((device) => (
            <li
              key={device.employeeId}
              className="flex flex-wrap items-center gap-2 rounded-xl border border-ink/8 bg-white/50 px-4 py-2.5"
            >
              <Smartphone
                size={14}
                strokeWidth={1.75}
                className={device.active > 0 ? "text-emerald-600" : "text-ink/25"}
              />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{device.name}</span>

              <span className={cn("text-xs", device.active > 0 ? "text-ink/55" : "text-ink/35")}>
                {device.active > 0
                  ? `${device.active} ${device.active === 1 ? "device" : "devices"}`
                  : "not enabled"}
              </span>

              {device.retired > 0 && (
                <span className="text-[11px] text-ink/35">{device.retired} retired</span>
              )}

              {device.lastUsedAt && (
                <span className="text-[11px] text-ink/35">
                  last {formatDayIn(timezone, device.lastUsedAt)} {formatTimeIn(timezone, device.lastUsedAt)}
                </span>
              )}

              {device.active > 0 && (
                <form action={sendTestPush.bind(null, device.employeeId)}>
                  <button
                    type="submit"
                    className="rounded-lg border border-ink/12 bg-white/70 px-2.5 py-1 text-xs font-medium text-ink/70 hover:bg-white"
                  >
                    Send a test
                  </button>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}

      {health.recent.length > 0 && (
        <details className="mt-3 rounded-xl border border-ink/8 bg-white/40 px-4 py-3">
          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wider text-ink/40">
            Last {health.recent.length} attempts
          </summary>
          <ul className="mt-2 flex flex-col gap-1">
            {health.recent.map((row, index) => (
              <li key={index} className="flex flex-wrap items-baseline gap-2 text-xs">
                <span
                  className={cn(
                    "font-semibold",
                    row.status === "SENT"
                      ? "text-emerald-700"
                      : row.status === "EXPIRED"
                        ? "text-amber-700"
                        : "text-pink-strong"
                  )}
                >
                  {row.status}
                </span>
                <span className="text-ink/55">{row.employee ?? "—"}</span>
                <span className="text-ink/35">
                  {formatDayIn(timezone, row.at)} {formatTimeIn(timezone, row.at)}
                </span>
                {row.detail && <span className="w-full break-words text-ink/40">{row.detail}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

function Check({
  ok,
  label,
  okText,
  badText,
}: {
  ok: boolean;
  label: string;
  okText: string;
  badText: string;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-xl border px-4 py-3",
        ok ? "border-emerald-500/20 bg-emerald-500/[0.06]" : "border-pink/20 bg-pink/[0.06]"
      )}
    >
      {ok ? (
        <CircleCheck size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-emerald-600" />
      ) : (
        <CircleAlert size={16} strokeWidth={2} className="mt-0.5 shrink-0 text-pink-strong" />
      )}
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink">{label}</p>
        <p className={cn("mt-0.5 text-sm", ok ? "text-ink/55" : "text-pink-strong")}>{ok ? okText : badText}</p>
      </div>
    </div>
  );
}
