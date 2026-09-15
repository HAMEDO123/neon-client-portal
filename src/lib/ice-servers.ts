import { usableIceServers, type IceServer } from "@/lib/calls";

// How the devices in a call find a way to each other.
//
// Two phones on ordinary networks usually reach each other directly once STUN
// has told each its public address. Some networks — mobile carriers, strict
// office firewalls — do not allow that, and then the call has to be relayed
// through a TURN server. Cloudflare runs both; STUN needs no account, TURN
// needs a key (CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_KEY_API_TOKEN, from
// the Realtime section of the Cloudflare dashboard). Without a key calls still
// work wherever a direct route exists.

const STUN_ONLY: IceServer[] = [{ urls: "stun:stun.cloudflare.com:3478" }];

// Credentials last a day; they are fetched again an hour before that.
const TTL_SECONDS = 24 * 60 * 60;
let cached: { servers: IceServer[]; until: number } | null = null;

export function turnConfigured() {
  return Boolean(process.env.CLOUDFLARE_TURN_KEY_ID && process.env.CLOUDFLARE_TURN_KEY_API_TOKEN);
}

export async function iceServers(): Promise<IceServer[]> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID;
  const token = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN;
  if (!keyId || !token) return STUN_ONLY;
  if (cached && cached.until > Date.now()) return cached.servers;

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      }
    );
    if (!response.ok) return STUN_ONLY;

    const servers = usableIceServers(await response.json());
    if (servers.length === 0) return STUN_ONLY;

    cached = { servers, until: Date.now() + (TTL_SECONDS - 60 * 60) * 1000 };
    return servers;
  } catch {
    // A call that can only go direct is better than no call.
    return STUN_ONLY;
  }
}
