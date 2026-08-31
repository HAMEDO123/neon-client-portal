"use client";

import { useState, type ReactNode } from "react";
import { Menu, X } from "lucide-react";
import { AdminNav } from "@/components/admin/admin-nav";

// The sidebar layout only works at desktop widths — on a phone (the iOS
// sideload wrapper, or just Safari) a fixed 256px sidebar eats most of the
// screen and crushes the content next to it. Below lg, swap it for a top bar
// + slide-in drawer instead.
export function AdminShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-ink/8 bg-white/40 lg:block">
        <AdminNav />
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-ink/8 bg-white/60 px-4 py-3 lg:hidden">
          <span className="text-base font-bold">
            <span className="text-gradient-neon">NEON</span>
            <span className="ml-1.5 text-sm font-medium text-ink/60">Admin</span>
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Open menu"
            className="rounded-lg p-2 text-ink/60 hover:bg-ink/5"
          >
            <Menu size={20} />
          </button>
        </div>

        <main className="flex-1 overflow-y-auto px-4 py-6 lg:px-8 lg:py-10">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className="absolute inset-0 bg-ink/40"
          />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[80vw] bg-bg shadow-xl" onClick={() => setOpen(false)}>
            <div className="flex justify-end p-3">
              <button
                type="button"
                aria-label="Close menu"
                onClick={() => setOpen(false)}
                className="rounded-lg p-2 text-ink/60 hover:bg-ink/5"
              >
                <X size={20} />
              </button>
            </div>
            <AdminNav />
          </div>
        </div>
      )}
    </div>
  );
}
