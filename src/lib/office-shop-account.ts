import { getSetting, setSetting } from "@/lib/settings";
import { open, seal } from "@/lib/secret-box";

// The office's shop account: one sign-in for the supermarket, kept here so
// every phone can use it instead of the manager typing it into each one.
//
// **This stores a password the platform can read back**, which is not how this
// codebase treats passwords anywhere else — the admin's is a bcrypt hash and an
// employee's is too. It is deliberate and it was decided after the trade-off
// was put plainly: the phone has to fill in the shop's own sign-in form, so a
// hash is no use.
//
// What follows from that, and must not be forgotten by whoever reads this next:
//
//   **Anybody the app answers to can read it.** The server decrypts it to
//   answer, so encryption protects a stolen database copy and nothing else. The
//   mitigation is `recordShopFetch` — a record of who asked and when — not the
//   encryption.
//
//   **It is the studio's own supermarket account**, not a bank. That is the
//   reason this is a reasonable thing to do at all, and the reason the same
//   arrangement must not be copied for anything that matters more.
//
// Not "use server": every export of one of those is callable over the network.

const EMAIL_KEY = "office_shop_email";
const PASSWORD_KEY = "office_shop_password";
const SITE_KEY = "office_shop_site";
const FETCH_KEY = "office_shop_last_fetch";

export type ShopAccount = { email: string; password: string; site: string | null };

/** What the manager sees: whether it is set, never the password itself. */
export type ShopAccountState = {
  email: string | null;
  site: string | null;
  hasPassword: boolean;
  /** Null when SESSION_SECRET has changed since it was stored. */
  readable: boolean;
  lastFetch: { name: string; at: string } | null;
};

export async function saveShopAccount(email: string, password: string | null, site: string | null) {
  await setSetting(EMAIL_KEY, email);
  await setSetting(SITE_KEY, site ?? "");
  // An empty password means "leave the one that is there": a manager editing
  // the email should not have to retype the password, and a blank box is how
  // every password field in this codebase already behaves.
  if (password && password.length > 0) await setSetting(PASSWORD_KEY, seal(password));
}

export async function clearShopAccount() {
  await setSetting(EMAIL_KEY, "");
  await setSetting(PASSWORD_KEY, "");
  await setSetting(SITE_KEY, "");
  await setSetting(FETCH_KEY, "");
}

/**
 * The sign-in itself, for a phone that is about to use it.
 *
 * Null when nothing is stored, or when what is stored cannot be opened —
 * which is what a changed `SESSION_SECRET` looks like. The caller says "ask
 * the manager to set it again" rather than handing over something broken.
 */
export async function shopAccount(): Promise<ShopAccount | null> {
  const [email, sealed, site] = await Promise.all([
    getSetting(EMAIL_KEY),
    getSetting(PASSWORD_KEY),
    getSetting(SITE_KEY),
  ]);

  const password = open(sealed);
  if (!email || !password) return null;

  return { email, password, site: site || null };
}

/**
 * Who last asked for it, and when.
 *
 * The real protection here. Encryption stops a stolen dump; this is what the
 * manager actually has, because the password reaches every phone that asks and
 * nothing can take that back. One row, overwritten — a full audit trail would
 * be a table and a screen, and is worth building the day this is ever in doubt.
 */
export async function recordShopFetch(employeeId: string | null, name: string) {
  await setSetting(FETCH_KEY, JSON.stringify({ id: employeeId, name, at: new Date().toISOString() }));
}

export async function shopAccountState(): Promise<ShopAccountState> {
  const [email, sealed, site, fetched] = await Promise.all([
    getSetting(EMAIL_KEY),
    getSetting(PASSWORD_KEY),
    getSetting(SITE_KEY),
    getSetting(FETCH_KEY),
  ]);

  let lastFetch: ShopAccountState["lastFetch"] = null;
  if (fetched) {
    try {
      const parsed = JSON.parse(fetched) as { name?: unknown; at?: unknown };
      if (typeof parsed.name === "string" && typeof parsed.at === "string") {
        lastFetch = { name: parsed.name, at: parsed.at };
      }
    } catch {
      // A row written by hand, or by an older shape. Not worth a crash.
    }
  }

  return {
    email: email || null,
    site: site || null,
    hasPassword: Boolean(sealed),
    readable: Boolean(sealed) && open(sealed) !== null,
    lastFetch,
  };
}

/** Kept here so the settings page and the phone route cannot disagree. */
export const SHOP_SETTING_KEYS = { EMAIL_KEY, PASSWORD_KEY, SITE_KEY, FETCH_KEY } as const;
