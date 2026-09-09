"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { markAdminAlertsRead } from "@/lib/admin-notifications";

export async function clearAdminAlerts() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) throw new Error("Unauthorized");

  await markAdminAlertsRead();
  revalidatePath("/admin/alerts");
}
