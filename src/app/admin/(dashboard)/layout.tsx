import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { adminSession } from "@/lib/session-token";
import { AdminShell } from "@/components/admin/admin-shell";
import { getAdminBadges } from "@/lib/admin-badges";
import { appVersion } from "@/lib/app-version";

export default async function AdminDashboardLayout({ children }: { children: ReactNode }) {
  // The session, and how long it may still edit for. A session past its hour
  // is still a session: it reads every screen, and the shell asks for the
  // password rather than signing anybody out (lib/admin-password.ts).
  const session = await adminSession();
  if (!session) {
    redirect("/admin/login");
  }

  const badges = await getAdminBadges();

  return (
    <AdminShell badges={badges} version={appVersion()} unlockedUntil={session.unlockedUntil}>
      {children}
    </AdminShell>
  );
}
