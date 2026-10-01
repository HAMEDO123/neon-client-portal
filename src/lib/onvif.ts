import crypto from "crypto";

// Just enough ONVIF to move a camera: its clock, where its services are, its
// media profile, continuous pan/tilt, stop, and its saved positions.
//
// Tapo cameras that pan and tilt (C200, C210, C220, C225, C500 …) answer ONVIF
// on port 2020 with their **Camera Account** — the username and password made
// in the Tapo app under the camera's Advanced Settings, not the Tapo login.
// A camera that cannot move simply has no PTZ service, or a profile with no
// PTZ configuration, and the app shows it no controls.
//
// No library: ONVIF is SOAP 1.2 over HTTP, and the handful of calls here are
// small fixed envelopes. The parts that need no network — the WS-Security
// header, the envelopes and reading the answers — are exported and tested on
// their own (tests/onvif.test.ts), and the answers are read by local element
// name so the camera's choice of namespace prefixes does not matter.
//
// **The camera's clock decides whether it believes us.** A UsernameToken
// digest carries the moment it was made, and a camera whose clock disagrees
// refuses it as an old message replayed. So the camera's own time is read
// first (GetSystemDateAndTime needs no sign-in) and every `Created` is written
// in the camera's time, whatever the office PC thinks the time is.

// --- WS-Security ------------------------------------------------------------------

const WSSE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd";
const WSU = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd";
const DIGEST_TYPE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest";
const NONCE_TYPE = "http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary";

/** WS-Security's PasswordDigest: Base64(SHA-1(nonce bytes + Created + password)). */
export function passwordDigest(nonce: Uint8Array, created: string, password: string): string {
  return crypto
    .createHash("sha1")
    .update(Buffer.concat([Buffer.from(nonce), Buffer.from(created, "utf8"), Buffer.from(password, "utf8")]))
    .digest("base64");
}

/** `Created` as WS-Security writes it: UTC, to the second. */
export function createdStamp(at: Date): string {
  return at.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function securityHeader(username: string, password: string, created: string, nonce: Uint8Array): string {
  return (
    `<Security s:mustUnderstand="1" xmlns="${WSSE}">` +
    `<UsernameToken>` +
    `<Username>${xmlEscape(username)}</Username>` +
    `<Password Type="${DIGEST_TYPE}">${passwordDigest(nonce, created, password)}</Password>` +
    `<Nonce EncodingType="${NONCE_TYPE}">${Buffer.from(nonce).toString("base64")}</Nonce>` +
    `<Created xmlns="${WSU}">${created}</Created>` +
    `</UsernameToken>` +
    `</Security>`
  );
}

export function envelope(body: string, header = ""): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope">` +
    (header ? `<s:Header>${header}</s:Header>` : "") +
    `<s:Body xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">${body}</s:Body>` +
    `</s:Envelope>`
  );
}

// --- The calls --------------------------------------------------------------------

const DEVICE = "http://www.onvif.org/ver10/device/wsdl";
const MEDIA = "http://www.onvif.org/ver10/media/wsdl";
const PTZ = "http://www.onvif.org/ver20/ptz/wsdl";
const SCHEMA = "http://www.onvif.org/ver10/schema";

const number = (value: number) => String(Math.round(value * 100) / 100);

export const calls = {
  systemDateAndTime: () => `<GetSystemDateAndTime xmlns="${DEVICE}"/>`,
  capabilities: () => `<GetCapabilities xmlns="${DEVICE}"><Category>All</Category></GetCapabilities>`,
  profiles: () => `<GetProfiles xmlns="${MEDIA}"/>`,
  continuousMove: (profile: string, x: number, y: number, seconds: number) =>
    `<ContinuousMove xmlns="${PTZ}"><ProfileToken>${xmlEscape(profile)}</ProfileToken>` +
    `<Velocity><PanTilt x="${number(x)}" y="${number(y)}" xmlns="${SCHEMA}"/></Velocity>` +
    `<Timeout>PT${number(seconds)}S</Timeout></ContinuousMove>`,
  stop: (profile: string) =>
    `<Stop xmlns="${PTZ}"><ProfileToken>${xmlEscape(profile)}</ProfileToken><PanTilt>true</PanTilt><Zoom>false</Zoom></Stop>`,
  presets: (profile: string) => `<GetPresets xmlns="${PTZ}"><ProfileToken>${xmlEscape(profile)}</ProfileToken></GetPresets>`,
  gotoPreset: (profile: string, preset: string) =>
    `<GotoPreset xmlns="${PTZ}"><ProfileToken>${xmlEscape(profile)}</ProfileToken><PresetToken>${xmlEscape(preset)}</PresetToken></GotoPreset>`,
};

// --- Reading the answers ------------------------------------------------------------

type Element = { attrs: string; inner: string };

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");
}

/** Every element with this local name, whatever its namespace prefix. Not for elements nested in themselves. */
export function elements(xml: string, local: string): Element[] {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${local}(?=[\\s/>])([^>]*?)(?:/>|>([\\s\\S]*?)</(?:[\\w.-]+:)?${local}\\s*>)`,
    "g"
  );
  return [...xml.matchAll(pattern)].map((match) => ({ attrs: match[1] ?? "", inner: match[2] ?? "" }));
}

export function textOf(xml: string, local: string): string | null {
  const found = elements(xml, local)[0];
  if (!found) return null;
  const text = unescapeXml(found.inner.replace(/<[^>]*>/g, "")).trim();
  return text || null;
}

export function attrOf(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)(?:[\\w.-]+:)?${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return match ? unescapeXml(match[1] ?? match[2] ?? "") : null;
}

/** The camera's own idea of now, from GetSystemDateAndTime's UTCDateTime. */
export function parseDeviceTime(xml: string): Date | null {
  const utc = elements(xml, "UTCDateTime")[0]?.inner;
  if (!utc) return null;
  const part = (name: string) => Number(textOf(utc, name));
  const [year, month, day, hour, minute, second] = ["Year", "Month", "Day", "Hour", "Minute", "Second"].map(part);
  if (![year, month, day, hour, minute, second].every(Number.isFinite) || year < 2000) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/** Where the camera's media and PTZ services are, from GetCapabilities. */
export function parseCapabilities(xml: string): { media: string | null; ptz: string | null } {
  const xaddr = (local: string) => {
    const block = elements(xml, local)[0]?.inner;
    return block ? textOf(block, "XAddr") : null;
  };
  return { media: xaddr("Media"), ptz: xaddr("PTZ") };
}

export type OnvifProfile = { token: string; name: string; ptz: boolean };

/** The camera's media profiles, and which of them can pan and tilt. */
export function parseProfiles(xml: string): OnvifProfile[] {
  return elements(xml, "Profiles").flatMap((profile) => {
    const token = attrOf(profile.attrs, "token");
    if (!token) return [];
    return [{ token, name: textOf(profile.inner, "Name") ?? token, ptz: elements(profile.inner, "PTZConfiguration").length > 0 }];
  });
}

export type OnvifPreset = { token: string; name: string };

/** The positions saved on the camera (in the Tapo app: "Marked positions"). */
export function parsePresets(xml: string): OnvifPreset[] {
  return elements(xml, "Preset").flatMap((preset) => {
    const token = attrOf(preset.attrs, "token");
    if (!token) return [];
    return [{ token, name: textOf(preset.inner, "Name") ?? token }];
  });
}

/** A SOAP fault, if that is what the camera answered. */
export function parseFault(xml: string): { reason: string | null; notAuthorized: boolean } | null {
  const fault = elements(xml, "Fault")[0];
  if (!fault) return null;
  const codes = elements(fault.inner, "Value").map((value) => value.inner).join(" ");
  const reason = textOf(fault.inner, "Text") ?? textOf(fault.inner, "faultstring");
  const notAuthorized = /NotAuthorized|FailedAuthentication|InvalidSecurity/i.test(codes) || /not\s*authori[sz]ed|authentication|password/i.test(reason ?? "");
  return { reason, notAuthorized };
}

/** The profile to move: the first that has PTZ, else nothing. */
export function movableProfile(profiles: OnvifProfile[]): string | null {
  return profiles.find((profile) => profile.ptz)?.token ?? null;
}

// --- Talking to a camera ------------------------------------------------------------

export class OnvifError extends Error {
  constructor(
    message: string,
    readonly kind: "unreachable" | "not-authorized" | "no-ptz" | "failed"
  ) {
    super(message);
  }
}

const TIMEOUT_MS = 4_000;

export type OnvifSession = {
  /** Camera time minus the office PC's, in ms. */
  skew: number;
  ptzUrl: string;
  profile: string;
};

/**
 * One camera's ONVIF, for as long as it is held: the clock is read and the
 * PTZ address and profile found once, then every move is one round trip.
 */
export class OnvifCamera {
  private session: OnvifSession | null = null;
  private skew = 0;

  constructor(
    readonly deviceUrl: string,
    private readonly username: string,
    private readonly password: string,
    private readonly fetcher: typeof fetch = fetch
  ) {}

  private async post(url: string, body: string, signed: boolean): Promise<string> {
    const header = signed
      ? securityHeader(this.username, this.password, createdStamp(new Date(Date.now() + this.skew)), crypto.randomBytes(16))
      : "";
    let response: Response;
    try {
      response = await this.fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/soap+xml; charset=utf-8" },
        body: envelope(body, header),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new OnvifError("The camera didn't answer on its control port.", "unreachable");
    }
    const text = await response.text().catch(() => "");
    const fault = parseFault(text);
    if (response.status === 401 || fault?.notAuthorized) {
      throw new OnvifError("The camera refused the Camera Account.", "not-authorized");
    }
    if (!response.ok || fault) throw new OnvifError(fault?.reason ?? `The camera answered ${response.status}.`, "failed");
    return text;
  }

  /** Clock, services and profile; throws OnvifError("no-ptz") for a camera that cannot move. */
  async connect(): Promise<OnvifSession> {
    if (this.session) return this.session;

    try {
      const time = parseDeviceTime(await this.post(this.deviceUrl, calls.systemDateAndTime(), false));
      if (time) this.skew = time.getTime() - Date.now();
    } catch (error) {
      if (error instanceof OnvifError && error.kind === "unreachable") throw error;
      // Some cameras want even this signed; carry on with the PC's clock.
    }

    const capabilities = parseCapabilities(await this.post(this.deviceUrl, calls.capabilities(), true));
    if (!capabilities.ptz) throw new OnvifError("This camera has no pan and tilt.", "no-ptz");
    const profile = movableProfile(parseProfiles(await this.post(capabilities.media ?? this.deviceUrl, calls.profiles(), true)));
    if (!profile) throw new OnvifError("This camera has no pan and tilt.", "no-ptz");

    this.session = { skew: this.skew, ptzUrl: capabilities.ptz, profile };
    return this.session;
  }

  async move(x: number, y: number, seconds = 1): Promise<void> {
    const session = await this.connect();
    await this.post(session.ptzUrl, calls.continuousMove(session.profile, x, y, seconds), true);
  }

  async stop(): Promise<void> {
    const session = await this.connect();
    await this.post(session.ptzUrl, calls.stop(session.profile), true);
  }

  async presets(): Promise<OnvifPreset[]> {
    const session = await this.connect();
    return parsePresets(await this.post(session.ptzUrl, calls.presets(session.profile), true));
  }

  async gotoPreset(token: string): Promise<void> {
    const session = await this.connect();
    await this.post(session.ptzUrl, calls.gotoPreset(session.profile, token), true);
  }
}
