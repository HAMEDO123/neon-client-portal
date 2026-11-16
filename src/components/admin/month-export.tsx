import { Download } from "lucide-react";

// A month and a download button. A plain GET form — no script — so the file
// is whatever the route makes of the month in the address, and the browser
// downloads it in place without leaving the page.
//
// The month is the studio's: picking November is 5 November to 4 December
// (lib/pay-period.ts), and the box says so, because a month picker on its own
// reads as the calendar.

export function MonthExport({ href, label, month }: { href: string; label: string; month: string }) {
  return (
    <form action={href} method="get" className="inline-flex shrink-0 items-center gap-1.5">
      <input
        type="month"
        name="month"
        defaultValue={month}
        aria-label="Month"
        required
        className="rounded-full border border-ink/12 bg-white/70 px-3 py-1.5 text-xs text-ink outline-none focus:border-cyan-strong"
      />
      <span className="text-[11px] text-ink/40">5th → 4th</span>
      <button
        type="submit"
        className="inline-flex items-center gap-1.5 rounded-full border border-emerald-600/25 bg-emerald-50/70 px-4 py-2 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
      >
        <Download size={14} strokeWidth={2} />
        {label}
      </button>
    </form>
  );
}
