// Naming a device from what its browser said about itself.
//
// A list of push subscriptions is otherwise a list of 200-character endpoint
// URLs, which tells somebody nothing about which phone in their pocket is which
// — and turning one off is a decision you cannot make about a string you do not
// recognise. Deliberately rough: the point is "your iPhone" versus "the office
// Mac", not exact version reporting.

export type DeviceName = { device: string; browser: string | null };

export function describeDevice(userAgent: string | null | undefined): DeviceName {
  const ua = (userAgent ?? "").trim();
  if (!ua) return { device: "Unknown device", browser: null };

  return { device: deviceOf(ua), browser: browserOf(ua) };
}

function deviceOf(ua: string) {
  if (/\biPad\b/i.test(ua)) return "iPad";
  if (/\biPhone\b/i.test(ua)) return "iPhone";
  if (/\biPod\b/i.test(ua)) return "iPod";
  if (/\bAndroid\b/i.test(ua)) return /\bMobile\b/i.test(ua) ? "Android phone" : "Android tablet";
  if (/\bWindows\b/i.test(ua)) return "Windows PC";
  if (/\bMac OS X\b|\bMacintosh\b/i.test(ua)) return "Mac";
  if (/\bCrOS\b/i.test(ua)) return "Chromebook";
  if (/\bLinux\b/i.test(ua)) return "Linux PC";
  return "Unknown device";
}

function browserOf(ua: string) {
  // Order matters: every one of these also claims to be Safari or Chrome.
  if (/\bEdgA?\//i.test(ua)) return "Edge";
  if (/\bOPR\/|\bOpera\b/i.test(ua)) return "Opera";
  if (/\bFxiOS\/|\bFirefox\//i.test(ua)) return "Firefox";
  if (/\bCriOS\//i.test(ua)) return "Chrome";
  if (/\bSamsungBrowser\//i.test(ua)) return "Samsung Internet";
  if (/\bChrome\//i.test(ua)) return "Chrome";
  if (/\bSafari\//i.test(ua)) return "Safari";
  return null;
}

/** "iPhone · Safari", or just the device when the browser adds nothing. */
export function deviceLabel(userAgent: string | null | undefined) {
  const { device, browser } = describeDevice(userAgent);
  return browser ? `${device} · ${browser}` : device;
}
