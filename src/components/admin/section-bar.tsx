// A row of the page's sections that stays at the top while it scrolls (the
// new UI, 2026-11-18) — for the pages whose content is wide (a month grid, a
// row of people), where a menu down the side would take the room the content
// needs. Settings and Payroll, which are forms, keep theirs down the side.

export function SectionBar({ items, label }: { items: { id: string; label: string }[]; label: string }) {
  return (
    <nav
      aria-label={label}
      className="scrollbar-none sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-ink/8 bg-paper/90 px-4 py-3 backdrop-blur lg:-mx-8 lg:px-8"
    >
      {items.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className="shrink-0 rounded-full border border-ink/12 bg-white px-4 py-1.5 text-sm font-medium text-ink/70 transition-colors hover:border-ink/30 hover:text-ink"
        >
          {item.label}
        </a>
      ))}
    </nav>
  );
}
