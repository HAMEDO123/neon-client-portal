import webpush from "web-push";
import { prisma } from "@/lib/db";

// The keys web push is signed with, and where they come from.
//
// Push used to need two environment variables set by hand on the host, which
// is a step that is easy to skip and gives no sign it was skipped: everything
// keeps working, notifications simply never leave the server. So the platform
// makes its own pair the first time it needs one and keeps it in the settings
// table — the same place the timezone lives, and the same trust boundary,
// since the app reads both.
//
// An explicitly configured pair still wins. Somebody who has set the variables
// meant to, and swapping the keys under a device that is already subscribed
// silently stops it receiving.

export const VAPID_PUBLIC_SETTING = "vapid_public_key";
export const VAPID_PRIVATE_SETTING = "vapid_private_key";

export type VapidKeys = {
  publicKey: string;
  privateKey: string;
  subject: string;
  source: "environment" | "database";
};

// Resolved once per process: this is read on every push, and the answer only
// changes on a deploy or the first generation.
let cached: VapidKeys | null = null;

function subjectOf() {
  const configured = process.env.VAPID_SUBJECT?.trim();
  if (configured) return configured;

  // web-push insists on a mailto: or https: subject. The app's own URL is the
  // most honest thing to point a push service at.
  const url = process.env.PUBLIC_APP_URL?.trim();
  if (url?.startsWith("https://")) return url;

  return "mailto:admin@neon.local";
}

export async function getVapidKeys(): Promise<VapidKeys | null> {
  if (cached) return cached;

  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (envPublic && envPrivate) {
    cached = { publicKey: envPublic, privateKey: envPrivate, subject: subjectOf(), source: "environment" };
    return cached;
  }

  try {
    const rows = await prisma.appSetting.findMany({
      where: { key: { in: [VAPID_PUBLIC_SETTING, VAPID_PRIVATE_SETTING] } },
    });
    const stored = new Map(rows.map((row) => [row.key, row.value]));
    const publicKey = stored.get(VAPID_PUBLIC_SETTING);
    const privateKey = stored.get(VAPID_PRIVATE_SETTING);

    if (publicKey && privateKey) {
      cached = { publicKey, privateKey, subject: subjectOf(), source: "database" };
      return cached;
    }

    // Nothing anywhere: make a pair and keep it. Two servers racing here both
    // write, and the upsert means the second one wins for both rows — so the
    // pair stays a pair, which is the only thing that has to hold.
    const generated = webpush.generateVAPIDKeys();
    await prisma.appSetting.upsert({
      where: { key: VAPID_PUBLIC_SETTING },
      create: { key: VAPID_PUBLIC_SETTING, value: generated.publicKey },
      update: { value: generated.publicKey },
    });
    await prisma.appSetting.upsert({
      where: { key: VAPID_PRIVATE_SETTING },
      create: { key: VAPID_PRIVATE_SETTING, value: generated.privateKey },
      update: { value: generated.privateKey },
    });

    cached = { ...generated, subject: subjectOf(), source: "database" };
    return cached;
  } catch {
    // A database that is down is not a reason to crash a notification; push
    // simply stays unavailable until it is back.
    return null;
  }
}

/** Forgets the resolved pair, so the next read picks up a change. */
export function forgetVapidKeys() {
  cached = null;
}
