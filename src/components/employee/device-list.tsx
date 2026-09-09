"use client";

import { useEffect, useState, useTransition } from "react";
import { Smartphone, Trash2 } from "lucide-react";
import { forgetDevice, setDeviceActive } from "@/lib/actions/device-actions";
import { currentSubscription } from "@/lib/push-client";
import { cn } from "@/lib/utils";

// Your devices, and which of them get notified.
//
// Push arrives on every device an account has registered, which is right for a
// phone and a tablet you both carry and wrong for a laptop in the office that
// pings all afternoon. So each one can be switched off on its own without
// turning push off everywhere, and the one you are reading this on says so.

export type DeviceRow = {
  id: string;
  endpoint: string;
  label: string;
  active: boolean;
  lastUsedAt: string | null;
  addedAt: string;
};

export function DeviceList({ devices }: { devices: DeviceRow[] }) {
  const [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    currentSubscription()
      .then((subscription) => setThisEndpoint(subscription?.endpoint ?? null))
      .catch(() => setThisEndpoint(null));
  }, []);

  if (devices.length === 0) return null;

  function run(action: () => Promise<unknown>) {
    start(async () => {
      await action();
    });
  }

  return (
    <div className={cn("glass rounded-2xl p-4", pending && "opacity-90")}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink/40">Your devices</h3>
      <p className="mt-1 text-xs text-ink/45">
        Only these receive your notifications. Turn one off to keep it quiet without switching push off everywhere.
      </p>

      <ul className="mt-3 flex flex-col gap-2">
        {devices.map((device) => {
          const isThis = thisEndpoint === device.endpoint;

          return (
            <li
              key={device.id}
              className="flex items-center gap-2.5 rounded-xl border border-ink/8 bg-white/60 px-3 py-2.5"
            >
              <Smartphone
                size={15}
                strokeWidth={1.75}
                className={device.active ? "shrink-0 text-emerald-600" : "shrink-0 text-ink/25"}
              />

              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium text-ink">{device.label}</span>
                  {isThis && (
                    <span className="shrink-0 rounded-full bg-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-strong">
                      This one
                    </span>
                  )}
                </span>
                <span className="block truncate text-[11px] text-ink/40">
                  {device.active ? "Receiving" : "Muted"}
                  {device.lastUsedAt ? ` · last ${device.lastUsedAt}` : ` · added ${device.addedAt}`}
                </span>
              </span>

              <button
                type="button"
                onClick={() => run(() => setDeviceActive(device.id, !device.active))}
                aria-pressed={device.active}
                aria-label={device.active ? `Mute ${device.label}` : `Unmute ${device.label}`}
                className={cn(
                  "relative h-6 w-11 shrink-0 rounded-full border transition-colors",
                  device.active ? "border-emerald-600 bg-emerald-600" : "border-ink/15 bg-ink/10"
                )}
              >
                <span
                  className={cn(
                    "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow transition-all",
                    device.active ? "left-[calc(100%-1.125rem)]" : "left-1"
                  )}
                />
              </button>

              {!isThis && (
                <button
                  type="button"
                  onClick={() => run(() => forgetDevice(device.id))}
                  aria-label={`Forget ${device.label}`}
                  className="shrink-0 rounded-md p-1.5 text-ink/25 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
