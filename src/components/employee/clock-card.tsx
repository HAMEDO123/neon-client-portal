import { Clock, Fingerprint, LogOut } from "lucide-react";
import { spell, type ClockDay } from "@/lib/clock-day";
import { formatTimeIn } from "@/lib/time";

// The day as the person working it needs it: when the device saw them in, when
// they have to be gone by, and whether anything is coming off.
//
// It sits at the top because the end of the day is no longer something anybody
// can assume. It moves with how late they were and with every step-out typed
// for them, and they are the one person who cannot work that out — the studio
// knows, payroll knows, and until this card existed they did not.

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wider text-ink/40">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold tabular-nums ${tone ?? "text-ink"}`}>{value}</p>
    </div>
  );
}

export function ClockCard({ day, timezone }: { day: ClockDay; timezone: string }) {
  // Nothing on a day the studio is closed: an empty card every Friday teaches
  // people to scroll past the one that matters on Sunday.
  if (!day.working) return null;

  const time = (at: Date | null) => (at ? (formatTimeIn(timezone, at) ?? "—") : "—");

  // Not seen yet. Said plainly rather than as a warning — the device not having
  // read a finger is not the same as somebody not being here, and this card
  // cannot tell the difference.
  if (!day.arrivedAt) {
    return (
      <section aria-label="Your day" className="rounded-2xl border border-warm-line bg-card p-4">
        <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
          <Fingerprint size={16} strokeWidth={2.25} />
          Not clocked in yet
        </h2>
        <p className="mt-1.5 text-sm text-ink/55">
          The day starts at {time(day.startsAt)}. Clock in on the fingerprint and your hours start from
          the moment it reads you.
        </p>
      </section>
    );
  }

  const done = day.departedAt !== null;
  const short = Math.round(day.shortHours * 100) / 100;

  return (
    <section aria-label="Your day" className="rounded-2xl border border-warm-line bg-card p-4">
      <h2 className="inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <Clock size={16} strokeWidth={2.25} />
        Your day
      </h2>

      <div className="mt-3 flex flex-wrap items-start gap-x-8 gap-y-3">
        <Fact label="Clocked in" value={time(day.arrivedAt)} />
        {done ? (
          <Fact label="Clocked out" value={time(day.departedAt)} />
        ) : (
          // Everybody has an hour to be gone by, open hours included: this said
          // "whenever you finish" while such a day was charged nothing, and
          // since 2026-11-04 it is charged like everybody else's.
          <Fact label="Clock out by" value={time(day.endsAt)} tone={day.moved ? "text-cyan-700" : "text-ink"} />
        )}
        {day.openHours && day.countsAs != null && (
          <Fact
            label="Counts as"
            value={`${day.countsAs}h`}
            tone={day.workedHours != null && day.workedHours > day.countsAs ? "text-cyan-700" : "text-ink"}
          />
        )}
      </div>

      {/* What open hours still means: no hour to arrive at, and pay reckoned
          in hours worked. It no longer means the day is uncharged. */}
      {day.openHours && (
        <p className="mt-3 rounded-xl bg-paper-soft/70 px-3 py-2 text-xs leading-relaxed text-ink/65">
          You start when you start — nothing is counted against you for the hour you arrive. The day is
          still <span className="font-semibold text-ink">8 hours</span> from then, like everybody
          else&apos;s.
          {day.workedHours != null && day.countsAs != null && day.workedHours > day.countsAs && (
            <> Today you were here {day.workedHours}h, which counts as {day.countsAs}h — there is no overtime.</>
          )}
        </p>
      )}

      {/* Why their end is not everybody else's. Without this the time above
          reads as a mistake to the person it belongs to. */}
      {!done && day.moved && (
        <p className="mt-3 rounded-xl bg-paper-soft/70 px-3 py-2 text-xs leading-relaxed text-ink/65">
          {day.lateHours > 0 &&
            `You clocked in ${spell(day.lateMinutes)} after the start, counted as ${day.lateHours} ${
              day.lateHours === 1 ? "hour" : "hours"
            }`}
          {day.lateHours > 0 && day.awayHours > 0 && ", and "}
          {day.awayHours > 0 &&
            `${spell(day.awayMinutes)} was stepped out, counted as ${day.awayHours} ${
              day.awayHours === 1 ? "hour" : "hours"
            }`}
          {" — whole hours, the way they are charged — so your day ends at "}
          <span className="font-semibold text-ink">{time(day.endsAt)}</span>
          {" instead of "}
          {time(day.usualEnd)}. The day is the same length wherever it starts.
        </p>
      )}

      {day.breaks.length > 0 && (
        <p className="mt-2 text-xs text-ink/50">
          Stepped out {day.breaks.map((item) => `${item.out}–${item.back}`).join(", ")}
        </p>
      )}

      <p
        className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium ${
          short > 0 ? "text-amber-700" : "text-emerald-700"
        }`}
      >
        <LogOut size={13} strokeWidth={2} />
        {/* One sentence for everybody. An hourly day used to get its own, which
            never mentioned a shortfall because there was never one to mention. */}
        {done
          ? short > 0
            ? `${short}h short of your day — that much comes off.`
            : "Full day. Nothing is taken off."
          : short > 0
            ? `${short}h is coming off so far.`
            : "Clock out by then and nothing is taken off."}
      </p>
    </section>
  );
}
