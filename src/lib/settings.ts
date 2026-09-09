import { prisma } from "@/lib/db";
import { resolveTimezone } from "@/lib/time";

// Platform settings live in a small key/value table so the timezone can be
// changed without a redeploy. The environment variable is the fallback, and a
// sane default is the fallback for that.

export const TIMEZONE_SETTING_KEY = "timezone";

export async function getSetting(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } }).catch(() => null);
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

export async function getTimezone() {
  return resolveTimezone(await getSetting(TIMEZONE_SETTING_KEY));
}
