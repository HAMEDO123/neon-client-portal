import {
  sendWhatsAppCloudMediaMessage,
  sendWhatsAppCloudMessage,
  verifyWhatsAppCloudCredentials,
  type WhatsAppCloudCredentials,
} from "@/lib/whatsapp/cloud-api";
import {
  getWhatsAppConfig as getWorkerConfig,
  normalisePhone,
  sendWhatsAppMedia as sendWorkerMedia,
  sendWhatsAppText as sendWorkerText,
  whatsAppHealth,
  type WhatsAppResult,
} from "@/lib/whatsapp/worker";

// One way to send a WhatsApp message, over whichever transport this
// deployment has.
//
//   cloud   — Meta's official Cloud API, from the nexora-whatsapp library.
//             Pure HTTPS, so it runs here on Render with nothing else needed.
//   worker  — the whatsapp-web.js session the Nixora app already holds. It
//             needs a browser and a persistent disk, which is why it lives
//             there and this portal only calls it.
//   none    — neither configured; the UI falls back to wa.me links, exactly
//             as it did before any of this existed.
//
// Cloud wins when both are set: it is the one that cannot get the number
// banned, which is the whole reason the library ships it.

export type Transport = "cloud" | "worker" | "none";

export { normalisePhone };

export function getCloudCredentials(): WhatsAppCloudCredentials | null {
  const phoneNumberId = process.env.WHATSAPP_CLOUD_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_CLOUD_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;

  return {
    phoneNumberId,
    accessToken,
    businessAccountId: process.env.WHATSAPP_CLOUD_BUSINESS_ACCOUNT_ID ?? "",
    appSecret: process.env.WHATSAPP_CLOUD_APP_SECRET ?? null,
  };
}

export function activeTransport(): Transport {
  if (getCloudCredentials()) return "cloud";
  if (getWorkerConfig()) return "worker";
  return "none";
}

export function isWhatsAppAvailable() {
  return activeTransport() !== "none";
}

/** Sends text over whichever transport is configured. */
export async function sendWhatsApp(phone: string, text: string): Promise<WhatsAppResult> {
  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: "That phone number does not look valid." };

  const cloud = getCloudCredentials();
  if (cloud) {
    try {
      await sendWhatsAppCloudMessage(cloud, to, text);
      return { ok: true, data: undefined };
    } catch (error) {
      // Meta's own message is the useful part — a template requirement, an
      // expired token, a number outside the 24-hour window.
      return { ok: false, error: error instanceof Error ? error.message : "The Cloud API send failed." };
    }
  }

  if (getWorkerConfig()) return sendWorkerText(to, text);

  return { ok: false, error: "WhatsApp is not configured on this deployment." };
}

/** Sends a file — a gallery PDF, a drawing — over whichever transport is configured. */
export async function sendWhatsAppFile(
  phone: string,
  file: { url?: string; base64?: string; mimeType: string; filename: string }
): Promise<WhatsAppResult> {
  const to = normalisePhone(phone);
  if (!to) return { ok: false, error: "That phone number does not look valid." };

  const cloud = getCloudCredentials();
  if (cloud) {
    if (!file.url) return { ok: false, error: "The Cloud API needs a URL for the file." };
    try {
      await sendWhatsAppCloudMediaMessage(cloud, to, file.url, file.mimeType, file.filename);
      return { ok: true, data: undefined };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "The Cloud API media send failed." };
    }
  }

  if (getWorkerConfig()) {
    // The worker takes bytes rather than a URL.
    const base64 =
      file.base64 ??
      (file.url ? Buffer.from(await (await fetch(file.url)).arrayBuffer()).toString("base64") : null);
    if (!base64) return { ok: false, error: "Nothing to send." };

    return sendWorkerMedia(to, {
      base64,
      mimeType: file.mimeType,
      filename: file.filename,
      asDocument: !file.mimeType.startsWith("image/"),
    });
  }

  return { ok: false, error: "WhatsApp is not configured on this deployment." };
}

export type ConnectionStatus = {
  transport: Transport;
  ok: boolean;
  detail: string;
  /** The number messages will come from, when the transport can tell us. */
  number?: string;
};

/** Checks the active transport is genuinely usable, not merely configured. */
export async function checkWhatsAppConnection(): Promise<ConnectionStatus> {
  const cloud = getCloudCredentials();
  if (cloud) {
    // Asks Meta, rather than assuming values that were typed in are valid.
    const verdict = await verifyWhatsAppCloudCredentials(cloud);
    return verdict.ok
      ? {
          transport: "cloud",
          ok: true,
          detail: verdict.verifiedName || "Verified with Meta",
          number: verdict.displayPhoneNumber,
        }
      : { transport: "cloud", ok: false, detail: verdict.error };
  }

  const worker = getWorkerConfig();
  if (worker) {
    const health = await whatsAppHealth();
    return health.ok
      ? { transport: "worker", ok: true, detail: `Worker for ${health.data.companyId}`, number: worker.line }
      : { transport: "worker", ok: false, detail: health.error };
  }

  return { transport: "none", ok: false, detail: "No WhatsApp transport is configured." };
}
