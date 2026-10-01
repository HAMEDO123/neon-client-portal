// What a shop keeps in the browser's local storage, shared with the cookies.
//
// Yaser Mall signs in with a phone number and an SMS code and keeps the result
// as a token in local storage ("wk_token"), sent with every request as a
// header — not in a cookie. Its own code says so: `localStorage.setItem(
// "wk_token", t.wk_token)` after the code is accepted. A shared sign-in made of
// cookies alone therefore signed nobody in. The entries travel with them.
//
// Pure, so the limits are tested: this comes from a phone.

export type ShopStorageItem = {
  /** The page origin the entry belongs to, "https://www.yasermallonline.com". */
  origin: string;
  key: string;
  value: string;
};

/** The entries a web view handed over, kept to what can go back in. */
export function readShopStorage(raw: unknown): ShopStorageItem[] {
  if (!Array.isArray(raw)) return [];

  const items: ShopStorageItem[] = [];
  for (const item of raw.slice(0, 50)) {
    if (!item || typeof item !== "object") continue;
    const one = item as Record<string, unknown>;
    const origin = typeof one.origin === "string" ? one.origin : "";
    const key = typeof one.key === "string" ? one.key.slice(0, 200) : "";
    if (!key || !/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(origin)) continue;
    items.push({ origin, key, value: typeof one.value === "string" ? one.value.slice(0, 8192) : "" });
  }
  return items;
}
