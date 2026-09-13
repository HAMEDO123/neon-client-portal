"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-guard";
import { markAdminAlertsRead } from "@/lib/admin-notifications";

export async function clearAdminAlerts() {
  await requireAdmin();

  await markAdminAlertsRead();
  revalidatePath("/admin/alerts");
}
