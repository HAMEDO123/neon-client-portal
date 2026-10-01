import { getSetting, setSetting } from "@/lib/settings";
import { open, seal } from "@/lib/secret-box";

// The office's shop sign-in, shared so every phone is on the one cart.
//
// **It stores a session, not a password, and that was forced by the shop.**
// The first build of this kept an email and a password, because that is what a
// shop account usually is. Yaser Mall has neither: it signs in with a phone
// number and an SMS code (أدخل رقم الهاتف → متابعة). There is no password to
// keep, and the code goes to the manager's own phone, so nothing an employee's
// handset could type would ever get it in.
//
// So the manager signs in once on their own phone, where the SMS arrives, and
// hands that signed-in session over. Every other phone loads it before opening
// the shop and is already in.
//
// What this costs, and it is the honest trade of the two:
//
//   **A session is weaker than a password, which is the good part.** It is not
//   the account: it cannot change the phone number, and signing out at the shop
//   kills every copy of it at once. It also expires on the shop's own schedule,
//   so a leaked copy stops working by itself.
//
//   **It expires, which is the bad part.** When the shop logs the office out,
//   every phone is out together and the manager shares a new one. Nothing here
//   can tell when that will be — only the shop knows — so the screens say when
//   it was last shared and leave the judgement to a person.
//
// Encrypted at rest for the same reason as before: the daily database dumps
// leave this machine. It protects a stolen copy and nothing else — anybody the
// app answers to can read it, which is why `recordShopFetch` exists.
//
// Not "use server": every export of one of those is callable over the network.

const SESSION_KEY = "office_shop_session";
const SHARED_KEY = "office_shop_shared";
const SITE_KEY = "office_shop_site";
const FETCH_KEY = "office_shop_last_fetch";

/** One cookie, as a web view hands it over and as a web view takes it back. */
export type ShopCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Seconds since the epoch, or null for a cookie that dies with the session. */
  expires: number | null;
  secure: boolean;
  httpOnly: boolean;
};

export type ShopSession = { cookies: ShopCookie[]; site: string | null };

export type ShopSessionState = {
  site: string | null;
  shared: { name: string; at: string } | null;
  /** False when nothing is stored, or when SESSION_SECRET has changed since. */
  readable: boolean;
  lastFetch: { name: string; at: string } | null;
};

/**
 * The manager's signed-in session, handed over for the rest of the office.
 *
 * Cookies only, and only the fields a web view needs to put them back. Anything
 * else the phone knows about the shop stays on the phone.
 */
export async function saveShopSession(cookies: ShopCookie[], byName: string, site: string | null) {
  await setSetting(SESSION_KEY, seal(JSON.stringify(cookies)));
  await setSetting(SHARED_KEY, JSON.stringify({ name: byName, at: new Date().toISOString() }));
  await setSetting(SITE_KEY, site ?? "");
  // A new sign-in starts a fresh record: who took the *old* one says nothing
  // useful about the new one.
  await setSetting(FETCH_KEY, "");
}

export async function clearShopSession() {
  for (const key of [SESSION_KEY, SHARED_KEY, SITE_KEY, FETCH_KEY]) await setSetting(key, "");
}

/**
 * The session for a phone about to open the shop.
 *
 * Null when nothing is shared, or when what is stored cannot be opened — the
 * caller then says "ask the manager to sign in again" rather than handing over
 * something broken.
 */
export async function shopSession(): Promise<ShopSession | null> {
  const [sealed, site] = await Promise.all([getSetting(SESSION_KEY), getSetting(SITE_KEY)]);

  const plain = open(sealed);
  if (!plain) return null;

  try {
    const cookies = JSON.parse(plain) as ShopCookie[];
    if (!Array.isArray(cookies) || cookies.length === 0) return null;
    return { cookies, site: site || null };
  } catch {
    return null;
  }
}

/**
 * Who last took it, and when.
 *
 * The real protection: the session reaches every phone that asks and nothing
 * can take that back, so what the manager actually has is the record of who
 * asked. One row, overwritten.
 */
export async function recordShopFetch(employeeId: string | null, name: string) {
  await setSetting(FETCH_KEY, JSON.stringify({ id: employeeId, name, at: new Date().toISOString() }));
}

export async function shopSessionState(): Promise<ShopSessionState> {
  const [sealed, shared, site, fetched] = await Promise.all([
    getSetting(SESSION_KEY),
    getSetting(SHARED_KEY),
    getSetting(SITE_KEY),
    getSetting(FETCH_KEY),
  ]);

  return {
    site: site || null,
    shared: readStamp(shared),
    readable: Boolean(sealed) && open(sealed) !== null,
    lastFetch: readStamp(fetched),
  };
}

function readStamp(raw: string | null): { name: string; at: string } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { name?: unknown; at?: unknown };
    return typeof parsed.name === "string" && typeof parsed.at === "string"
      ? { name: parsed.name, at: parsed.at }
      : null;
  } catch {
    return null;
  }
}

/** Kept here so the settings page and the phone routes cannot disagree. */
export const SHOP_SETTING_KEYS = { SESSION_KEY, SHARED_KEY, SITE_KEY, FETCH_KEY } as const;
