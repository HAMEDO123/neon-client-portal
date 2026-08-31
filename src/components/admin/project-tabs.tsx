"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { key: "", label: "Overview" },
  { key: "gallery", label: "Gallery" },
  { key: "drawings", label: "Drawings" },
  { key: "boq", label: "BOQ" },
  { key: "pricing", label: "Pricing" },
  { key: "materials", label: "Materials" },
  { key: "furniture", label: "Furniture" },
  { key: "documents", label: "Documents" },
  { key: "approvals", label: "Approvals" },
  { key: "comments", label: "Comments" },
  { key: "analytics", label: "Analytics" },
];

export function ProjectTabs({ projectId, className }: { projectId: string; className?: string }) {
  const pathname = usePathname();
  const base = `/admin/projects/${projectId}`;

  return (
    <div className={cn("scrollbar-none flex gap-1 overflow-x-auto border-b border-ink/8", className)}>
      {TABS.map((tab) => {
        const href = tab.key ? `${base}/${tab.key}` : base;
        const active = pathname === href;
        return (
          <Link
            key={tab.key}
            href={href}
            className={cn(
              "shrink-0 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors",
              active ? "border-cyan-strong text-ink" : "border-transparent text-ink/45 hover:text-ink"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
