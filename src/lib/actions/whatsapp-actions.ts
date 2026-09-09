"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { logActivity } from "@/lib/activity";
import { setSetting, TIMEZONE_SETTING_KEY } from "@/lib/settings";
import { resolveTimezone } from "@/lib/time";
import { sendWhatsApp, sendWhatsAppFile } from "@/lib/whatsapp";

// Sending through the shared WhatsApp worker, plus the platform settings that
// live beside it. Admin only — these send real messages to real clients.

async function requireAdmin() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value)) {
    throw new Error("Unauthorized");
  }
}

export type SendOutcome = { ok: boolean; message: string };

/**
 * Sends a project's link to its client. Whether this is the first send or an
 * update only changes the wording and what gets logged.
 */
export async function sendProjectWhatsApp(
  projectId: string,
  kind: "sent_to_client" | "sent_update",
  formData?: FormData
): Promise<SendOutcome> {
  await requireAdmin();

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, token: true, clientName: true, clientPhone: true },
  });

  const phone = String(formData?.get("phone") ?? "") || project.clientPhone || "";
  if (!phone) return { ok: false, message: "This project has no client phone number." };

  const baseUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  const link = `${baseUrl}/p/${project.token}`;

  const custom = String(formData?.get("message") ?? "").trim();
  const text =
    custom ||
    (kind === "sent_to_client"
      ? `Hi ${project.clientName}, your project from NEON is ready. You can review the designs, drawings, quantities and more here: ${link}`
      : `Hi ${project.clientName}, there's an update on your NEON project. View the latest here: ${link}`);

  const result = await sendWhatsApp(phone, text);

  if (!result.ok) return { ok: false, message: result.error };

  // Logged the same way the manual WhatsApp buttons log, so the client
  // timeline reads the same however the message went out.
  await logActivity(projectId, kind, `WhatsApp to ${phone}`);
  revalidatePath(`/admin/projects/${projectId}`);

  return { ok: true, message: `Sent to ${phone}.` };
}

/** A one-off message, for testing the connection from Settings. */
export async function sendTestWhatsApp(formData: FormData): Promise<SendOutcome> {
  await requireAdmin();

  const phone = String(formData.get("phone") ?? "").trim();
  const text = String(formData.get("text") ?? "").trim() || "Test message from the NEON portal.";

  if (!phone) return { ok: false, message: "Enter a number to send to." };

  const result = await sendWhatsApp(phone, text);
  return result.ok ? { ok: true, message: `Sent to ${phone}.` } : { ok: false, message: result.error };
}

export async function saveTimezone(formData: FormData) {
  await requireAdmin();

  const requested = String(formData.get("timezone") ?? "").trim();
  const timezone = resolveTimezone(requested);

  await setSetting(TIMEZONE_SETTING_KEY, timezone);

  // The daily jobs and every "today" on the board read this.
  revalidatePath("/admin/settings");
  revalidatePath("/admin/tasks");
  revalidatePath("/employee", "layout");
}

/** Sends a project's gallery PDF straight to the client on WhatsApp. */
export async function sendGalleryPdfWhatsApp(projectId: string): Promise<SendOutcome> {
  await requireAdmin();

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { name: true, token: true, clientName: true, clientPhone: true, allowDownloads: true, publishState: true },
  });

  if (!project.clientPhone) return { ok: false, message: "This project has no client phone number." };
  if (project.publishState !== "PUBLISHED" || !project.allowDownloads) {
    return { ok: false, message: "Publish the project and allow downloads first." };
  }

  const baseUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ?? "";
  if (!baseUrl) return { ok: false, message: "PUBLIC_APP_URL is not set, so the file has no address to fetch from." };

  const result = await sendWhatsAppFile(project.clientPhone, {
    url: `${baseUrl}/p/${project.token}/gallery.pdf`,
    mimeType: "application/pdf",
    filename: `${project.name} - Gallery.pdf`,
  });

  if (!result.ok) return { ok: false, message: result.error };

  await logActivity(projectId, "sent_update", "Gallery PDF sent on WhatsApp");
  return { ok: true, message: `Gallery sent to ${project.clientPhone}.` };
}
