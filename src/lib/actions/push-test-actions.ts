"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { dispatchNotification } from "@/lib/notifications/engine";
import { DASHBOARD_PATH } from "@/lib/notifications/types";

/**
 * A real notification, sent on purpose.
 *
 * It goes through the same engine as everything else — preferences, devices,
 * delivery log — so if it does not arrive, the log on the Settings page says
 * exactly where it stopped. A test that used a special path would prove
 * nothing about the ones that matter.
 */
export async function sendTestPush(employeeId: string) {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) throw new Error("Unauthorized");

  await dispatchNotification({
    employeeId,
    type: "SYSTEM_NOTIFICATION",
    title: "Test notification",
    message: "If you can read this on your phone, push is working.",
    url: DASHBOARD_PATH,
    // Minute-stamped so a second test a minute later is a second notification,
    // while a double-submitted form is not.
    dedupeKey: `PUSH_TEST:${employeeId}:${new Date().toISOString().slice(0, 16)}`,
  });

  revalidatePath("/admin/settings");
}
