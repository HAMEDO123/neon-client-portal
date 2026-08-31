import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { AdminNav } from "@/components/admin/admin-nav";

export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;

  if (!verifySessionToken(token)) {
    redirect("/admin/login");
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="w-64 shrink-0 border-r border-ink/8 bg-white/40">
        <AdminNav />
      </aside>
      <main className="flex-1 overflow-y-auto px-8 py-10">
        <div className="mx-auto max-w-5xl">{children}</div>
      </main>
    </div>
  );
}
