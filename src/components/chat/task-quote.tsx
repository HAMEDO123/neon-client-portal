import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import { cn } from "@/lib/utils";

// The task a message asks about, drawn above what was said — the way a reply
// quotes what it answers. It opens the task where this reader has somewhere to
// go (lib/task-questions.ts decides that) and is only a label where they have
// not: in the company's group everybody sees the quote, and a task's page is
// its owner's alone.
//
// Drawn by both portals, so nothing here is one palette's alone.
export function TaskQuote({ title, href, studio }: { title: string; href: string | null; studio: boolean }) {
  const className = cn(
    "mb-1.5 flex min-w-44 items-center gap-2 rounded-lg border-l-[3px] border-clay px-2.5 py-1.5",
    studio ? "bg-bark/[0.05]" : "bg-ink/[0.05]",
    href && "transition-colors hover:bg-black/[0.08]"
  );

  const inside = (
    <>
      <ClipboardList size={15} strokeWidth={2} className="shrink-0 opacity-55" />
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] font-semibold uppercase tracking-wide opacity-55">About the task</span>
        <span dir="auto" className="block truncate text-[13px] font-semibold">
          {title}
        </span>
      </span>
      {href && <ChevronRight size={15} strokeWidth={2} className="shrink-0 opacity-40" />}
    </>
  );

  return href ? (
    <Link href={href} className={className}>
      {inside}
    </Link>
  ) : (
    <div className={className}>{inside}</div>
  );
}
