// A face for somebody who has no photo: their initials on their colour.
//
// It is the picture on a chat notification, in the place WhatsApp puts the
// sender's photo. Where it shows depends on the device, not on us: Android and
// desktop browsers draw it; an iPhone draws the app's own icon on every
// notification from a web app and ignores any picture it is given. Apple keeps
// the sender-photo style for App Store apps.
//
// Pure — the route renders it to a PNG, the tests read it.

const PALETTE: Record<string, string> = {
  cyan: "#0891b2",
  purple: "#7c3aed",
  pink: "#db2777",
  orange: "#ea580c",
  // The manager, and anybody whose colour is unknown.
  ink: "#15131f",
};

export function avatarColor(color: string | null | undefined) {
  return PALETTE[color ?? ""] ?? PALETTE.ink;
}

/** "Hamed Samir" → "HS", "Wael" → "W". The first and last word, as WhatsApp does. */
export function initialsOf(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";

  const picked = words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  // Array.from, not [0]: a letter outside the basic plane is two code units.
  return picked.map((word) => Array.from(word)[0]).join("").toUpperCase();
}

export function avatarSvg(name: string, color?: string | null, size = 192) {
  const initials = initialsOf(name);
  const fontSize = Math.round(size * (initials.length > 1 ? 0.38 : 0.46));
  const half = size / 2;

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<circle cx="${half}" cy="${half}" r="${half}" fill="${avatarColor(color)}"/>` +
    `<text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" ` +
    `font-weight="600" font-size="${fontSize}" fill="#ffffff">${escapeXml(initials)}</text>` +
    `</svg>`
  );
}

/** Where a notification fetches the picture from. Relative: the service worker resolves it. */
export function avatarUrl(name: string, color?: string | null) {
  const params = new URLSearchParams({ name, color: color ?? "ink" });
  return `/api/avatar?${params.toString()}`;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
