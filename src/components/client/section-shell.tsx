import { cn } from "@/lib/utils";

export function SectionShell({
  id,
  className,
  children,
  dark = false,
}: {
  id: string;
  className?: string;
  children: React.ReactNode;
  dark?: boolean;
}) {
  return (
    <section
      id={id}
      data-nav-section={id}
      className={cn("scroll-mt-24 py-16 sm:py-24", dark && "bg-ink text-bg", className)}
    >
      <div className="container-neon">{children}</div>
    </section>
  );
}
