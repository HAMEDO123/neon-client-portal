// The office's shared shop cart (the iOS app's "Office shopping": the
// supermarket's own website, in a web view, signed in to one office account on
// every phone). Everybody adds to the same cart; only the manager orders.
//
// The cart itself lives at the shop. What the platform keeps is the telling:
// somebody added something, so the manager knows the cart moved without
// having to open it. Pure, so the wording and the throttle are tested.

/** What the app saw added, cleaned up: one line, no longer than a heading. */
export function shoppingLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const line = raw.replace(/\s+/g, " ").trim().slice(0, 80);
  return line.length > 0 ? line : null;
}

/**
 * One alert per person per thing per ten minutes: tapping "+" five times on
 * the same coffee is one addition to be told about, not five.
 */
export function shoppingDedupeKey(employeeId: string, label: string | null, now: Date): string {
  const bucket = Math.floor(now.getTime() / (10 * 60 * 1000));
  return `OFFICE_CART:${employeeId}:${(label ?? "item").toLowerCase()}:${bucket}`;
}

export function shoppingMessage(name: string, label: string | null): { title: string; message: string } {
  return label
    ? { title: `${name} added to the office cart`, message: label }
    : { title: `${name} added to the office cart`, message: "Something new is in the cart." };
}
