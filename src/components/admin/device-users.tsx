"use client";

import { useActionState } from "react";
import { TriangleAlert, UserPlus, Trash2 } from "lucide-react";
import {
  addDeviceUser,
  clearDeviceAttendanceLog,
  deleteDeviceUser,
  type DeviceWrite,
} from "@/lib/actions/operations-actions";

// Who the device knows, and the three things that change it: add somebody,
// remove somebody, wipe its log.
//
// Every one of these writes to a machine on the wall, so every one reports back
// in words. A destructive button whose only feedback is the page looking
// slightly different afterwards is a button people press twice.

export type EnrolledUser = {
  uid: number;
  deviceUserId: string;
  name: string;
  isAdmin: boolean;
};

export type PairedPerson = { deviceUserId: string; name: string; active: boolean };

export function DeviceUsers({
  users,
  paired,
  canReach,
}: {
  users: EnrolledUser[];
  paired: PairedPerson[];
  /** False when the device did not answer — the forms are pointless then. */
  canReach: boolean;
}) {
  const [added, runAdd, adding] = useActionState<DeviceWrite | null, FormData>(
    async (_prev, formData) => await addDeviceUser(formData),
    null
  );
  const [removed, runRemove, removing] = useActionState<DeviceWrite | null, FormData>(
    async (_prev, formData) => await deleteDeviceUser(formData),
    null
  );
  const [wiped, runWipe, wiping] = useActionState<DeviceWrite | null, FormData>(
    async (_prev, formData) => await clearDeviceAttendanceLog(formData),
    null
  );

  const pairedBy = new Map(paired.map((person) => [person.deviceUserId, person]));

  // The next free number, so nobody has to work it out or collide with one.
  const suggested = String(
    users.reduce((highest, user) => Math.max(highest, Number(user.deviceUserId) || 0), 0) + 1
  );

  return (
    <div>
      <h2 className="mt-10 text-sm font-medium uppercase tracking-wider text-bark/40">Enrolled on the device</h2>

      {users.length === 0 ? (
        <p className="mt-2 text-sm text-bark/50">
          {canReach ? "Nobody is enrolled yet." : "Cannot read the device just now."}
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-warm-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-clay-soft/40 text-xs uppercase tracking-wider text-bark/45">
              <tr>
                <th className="px-4 py-3">Number</th>
                <th className="px-4 py-3">Name on the device</th>
                <th className="px-4 py-3">In the platform</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const person = pairedBy.get(user.deviceUserId);
                return (
                  <tr key={user.uid} className="border-t border-warm-line">
                    <td className="px-4 py-3 tabular-nums text-bark/60">{user.deviceUserId}</td>
                    <td className="px-4 py-3 font-medium text-bark">
                      {user.name || "—"}
                      {user.isAdmin && <span className="ml-2 text-[11px] text-bark/40">device admin</span>}
                    </td>
                    <td className="px-4 py-3">
                      {person ? (
                        <span className="text-bark/70">
                          {person.name}
                          {!person.active && <span className="text-bark/40"> · no longer on the team</span>}
                        </span>
                      ) : (
                        <span className="text-amber-700">not paired — nothing is recorded for this number</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form
                        action={runRemove}
                        onSubmit={(event) => {
                          if (
                            !confirm(
                              `Remove ${user.name || "this person"} from the device? Their past punches stay in its log; the person is removed.`
                            )
                          ) {
                            event.preventDefault();
                          }
                        }}
                      >
                        {/* uid, not the number above: the protocol deletes by slot. */}
                        <input type="hidden" name="uid" value={user.uid} />
                        <input type="hidden" name="deviceUserId" value={user.deviceUserId} />
                        <button
                          type="submit"
                          disabled={removing}
                          className="inline-flex items-center gap-1.5 rounded-full border border-warm-line px-3 py-1.5 text-xs text-bark/60 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 size={12} strokeWidth={2} />
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {removed && <Result result={removed} />}

      {/* --- Add somebody -------------------------------------------------- */}
      <form action={runAdd} className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-warm-line bg-card p-4">
        <label>
          <span className="mb-1 block text-xs font-medium text-bark/50">Number</span>
          <input
            name="deviceUserId"
            defaultValue={suggested}
            inputMode="numeric"
            required
            className="w-24 rounded-lg border border-warm-line bg-paper-soft px-3 py-2 text-sm text-bark outline-none focus:border-clay"
          />
        </label>
        <label className="min-w-40 flex-1">
          <span className="mb-1 block text-xs font-medium text-bark/50">Name on the device</span>
          <input
            name="name"
            maxLength={24}
            required
            placeholder="as it should show on the screen"
            className="w-full rounded-lg border border-warm-line bg-paper-soft px-3 py-2 text-sm text-bark outline-none placeholder:text-bark/30 focus:border-clay"
          />
        </label>
        <button
          type="submit"
          disabled={adding || !canReach}
          className="inline-flex items-center gap-2 rounded-full bg-clay px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-clay-deep disabled:opacity-50"
        >
          <UserPlus size={15} strokeWidth={2} />
          {adding ? "Adding…" : "Add to device"}
        </button>

        <p className="w-full text-xs text-bark/45">
          This creates the record, not the fingerprint. The person still has to put their finger on the reader at the
          machine — that cannot be done from here.
        </p>
      </form>

      {added && <Result result={added} />}

      {/* --- Wipe the log --------------------------------------------------- */}
      <details className="mt-6 rounded-2xl border border-red-200 bg-red-50/40 p-4">
        <summary className="cursor-pointer text-sm font-medium text-red-800">Wipe the device&apos;s log</summary>

        <p className="mt-2 text-xs text-bark/70">
          This cannot be undone, and it destroys arrivals that exist nowhere else: a sync only records days from its
          cutoff onward, so everything older lives only on the machine. The device currently holds punches going back
          years.
        </p>

        <form action={runWipe} className="mt-3 flex flex-wrap items-end gap-3">
          <label>
            <span className="mb-1 block text-xs font-medium text-bark/50">Type WIPE to confirm</span>
            <input
              name="confirm"
              autoComplete="off"
              className="w-32 rounded-lg border border-red-200 bg-white px-3 py-2 text-sm text-bark outline-none focus:border-red-400"
            />
          </label>
          <button
            type="submit"
            disabled={wiping || !canReach}
            className="rounded-full bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
          >
            {wiping ? "Clearing…" : "Clear the log"}
          </button>
        </form>

        {wiped && <Result result={wiped} />}
      </details>
    </div>
  );
}

function Result({ result }: { result: DeviceWrite }) {
  return (
    <p
      className={
        result.ok
          ? "mt-3 rounded-xl border border-warm-line bg-paper-soft p-3 text-xs text-bark/70"
          : "mt-3 flex items-start gap-2 rounded-xl border border-amber-500/25 bg-amber-500/[0.07] p-3 text-xs text-bark/75"
      }
    >
      {!result.ok && <TriangleAlert size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-amber-600" />}
      <span>{result.ok ? result.message : result.error}</span>
    </p>
  );
}
