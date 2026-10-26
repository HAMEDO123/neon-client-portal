"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { ChevronDown } from "lucide-react";

// Picking the pay month, as a list rather than a walk.
//
// "Previous month" steps one at a time, which is fine for last month and no
// use for August — three clicks, each a page load, to answer one question. The
// months are known, so they are offered.
//
// It moves the whole page, not only the list it sits beside: salaries,
// attendance, deductions and receipts are one month's reading of the same
// payroll, and a screen whose halves showed different months would be worse
// than one that does not move at all.

export function PeriodSelect({
  period,
  options,
  labels,
}: {
  period: string;
  /** Newest first, "YYYY-MM". */
  options: string[];
  /** The same keys, as a person reads them: "October 2026". */
  labels: Record<string, string>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <span className="relative inline-flex items-center">
      <select
        aria-label="Pay month"
        value={period}
        disabled={pending}
        onChange={(event) => {
          const next = event.target.value;
          if (next === period) return;
          start(() => router.push(`/admin/payroll?period=${next}`));
        }}
        className="appearance-none rounded-full border border-ink/12 bg-white/70 py-1.5 pl-3.5 pr-8 text-xs font-medium text-ink/70 outline-none hover:text-ink focus:border-cyan-strong disabled:opacity-60"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {labels[option] ?? option}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        strokeWidth={2}
        aria-hidden
        className="pointer-events-none absolute right-3 text-ink/35"
      />
    </span>
  );
}
