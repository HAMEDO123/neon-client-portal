import crypto from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

// A stand-in for a Tapo camera's ONVIF service on port 2020, for
// tests/onvif.test.ts and for trying the whole camera path by hand.
//
// It answers the way a Tapo C200 does — the same namespaces, the same SOAP 1.2
// fault for a refused account — and it is strict where a camera is strict:
// every call but GetSystemDateAndTime must carry a WS-Security UsernameToken
// whose PasswordDigest is right for the Camera Account's password **and**
// whose Created is within a few seconds of the camera's own clock, which is
// deliberately set wrong (`skewMs`) so a client that does not correct for it
// is refused. It checks the digest with its own reading of the request, not
// with lib/onvif.ts, so the two cannot agree by sharing a mistake.

export type StandInOptions = {
  username?: string;
  password?: string;
  /** How far the camera's clock is from the truth. */
  skewMs?: number;
  /** A camera that cannot pan or tilt (C100, C110 …). */
  fixed?: boolean;
};

export type StandIn = {
  url: string;
  port: number;
  moves: { x: number; y: number; timeout: string | null }[];
  stops: number;
  gone: string[];
  refused: number;
  close: () => Promise<void>;
};

const NS =
  'xmlns:SOAP-ENV="http://www.w3.org/2003/05/soap-envelope" xmlns:tt="http://www.onvif.org/ver10/schema" ' +
  'xmlns:tds="http://www.onvif.org/ver10/device/wsdl" xmlns:trt="http://www.onvif.org/ver10/media/wsdl" ' +
  'xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" xmlns:ter="http://www.onvif.org/ver10/error"';

const soap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><SOAP-ENV:Envelope ${NS}><SOAP-ENV:Header></SOAP-ENV:Header><SOAP-ENV:Body>${body}</SOAP-ENV:Body></SOAP-ENV:Envelope>`;

const NOT_AUTHORIZED = soap(
  "<SOAP-ENV:Fault><SOAP-ENV:Code><SOAP-ENV:Value>SOAP-ENV:Sender</SOAP-ENV:Value><SOAP-ENV:Subcode><SOAP-ENV:Value>ter:NotAuthorized</SOAP-ENV:Value></SOAP-ENV:Subcode></SOAP-ENV:Code>" +
    '<SOAP-ENV:Reason><SOAP-ENV:Text xml:lang="en">Sender not Authorized</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>'
);

const pick = (xml: string, tag: string) => new RegExp(`<(?:\\w+:)?${tag}[^>]*>([^<]*)</(?:\\w+:)?${tag}>`).exec(xml)?.[1] ?? null;

export async function onvifStandIn(options: StandInOptions = {}): Promise<StandIn> {
  const username = options.username ?? "viewer";
  const password = options.password ?? "secret";
  const skewMs = options.skewMs ?? 2 * 60 * 60_000;
  const state: StandIn = { url: "", port: 0, moves: [], stops: 0, gone: [], refused: 0, close: async () => {} };

  const server: Server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const now = new Date(Date.now() + skewMs);
      const reply = (status: number, body: string) => {
        response.writeHead(status, { "content-type": "application/soap+xml; charset=utf-8" });
        response.end(body);
      };

      if (raw.includes("GetSystemDateAndTime")) {
        return reply(
          200,
          soap(
            "<tds:GetSystemDateAndTimeResponse><tds:SystemDateAndTime><tt:DateTimeType>NTP</tt:DateTimeType><tt:DaylightSavings>false</tt:DaylightSavings>" +
              `<tt:UTCDateTime><tt:Time><tt:Hour>${now.getUTCHours()}</tt:Hour><tt:Minute>${now.getUTCMinutes()}</tt:Minute><tt:Second>${now.getUTCSeconds()}</tt:Second></tt:Time>` +
              `<tt:Date><tt:Year>${now.getUTCFullYear()}</tt:Year><tt:Month>${now.getUTCMonth() + 1}</tt:Month><tt:Day>${now.getUTCDate()}</tt:Day></tt:Date></tt:UTCDateTime>` +
              "</tds:SystemDateAndTime></tds:GetSystemDateAndTimeResponse>"
          )
        );
      }

      // Everything else: the Camera Account, digested, on the camera's clock.
      const user = pick(raw, "Username");
      const digest = pick(raw, "Password");
      const nonce = pick(raw, "Nonce");
      const created = pick(raw, "Created");
      const expected =
        nonce && created
          ? crypto.createHash("sha1").update(Buffer.concat([Buffer.from(nonce, "base64"), Buffer.from(created), Buffer.from(password)])).digest("base64")
          : null;
      const fresh = created ? Math.abs(Date.parse(created) - now.getTime()) < 10_000 : false;
      if (user !== username || !expected || digest !== expected || !fresh) {
        state.refused += 1;
        return reply(400, NOT_AUTHORIZED);
      }

      const service = `http://127.0.0.1:${state.port}/onvif/service`;
      if (raw.includes("GetCapabilities")) {
        return reply(
          200,
          soap(
            "<tds:GetCapabilitiesResponse><tds:Capabilities>" +
              `<tt:Device><tt:XAddr>http://127.0.0.1:${state.port}/onvif/device_service</tt:XAddr></tt:Device>` +
              `<tt:Events><tt:XAddr>${service}</tt:XAddr></tt:Events>` +
              `<tt:Imaging><tt:XAddr>${service}</tt:XAddr></tt:Imaging>` +
              `<tt:Media><tt:XAddr>${service}</tt:XAddr><tt:StreamingCapabilities><tt:RTPMulticast>false</tt:RTPMulticast></tt:StreamingCapabilities></tt:Media>` +
              (options.fixed ? "" : `<tt:PTZ><tt:XAddr>${service}</tt:XAddr></tt:PTZ>`) +
              "</tds:Capabilities></tds:GetCapabilitiesResponse>"
          )
        );
      }
      if (raw.includes("GetProfiles")) {
        const ptz = options.fixed ? "" : '<tt:PTZConfiguration token="PTZConfigurationToken"><tt:Name>PTZConfig</tt:Name><tt:NodeToken>PTZNodeToken</tt:NodeToken></tt:PTZConfiguration>';
        return reply(
          200,
          soap(
            "<trt:GetProfilesResponse>" +
              `<trt:Profiles fixed="true" token="profile_1"><tt:Name>mainStream</tt:Name><tt:VideoSourceConfiguration token="vsconf"><tt:Name>VideoSourceConfig</tt:Name></tt:VideoSourceConfiguration>${ptz}</trt:Profiles>` +
              `<trt:Profiles fixed="true" token="profile_2"><tt:Name>minorStream</tt:Name>${ptz}</trt:Profiles>` +
              "</trt:GetProfilesResponse>"
          )
        );
      }
      if (raw.includes("ContinuousMove")) {
        const pan = /<(?:\w+:)?PanTilt[^>]*\bx="([^"]+)"[^>]*\by="([^"]+)"/.exec(raw);
        state.moves.push({ x: Number(pan?.[1]), y: Number(pan?.[2]), timeout: pick(raw, "Timeout") });
        return reply(200, soap("<tptz:ContinuousMoveResponse></tptz:ContinuousMoveResponse>"));
      }
      if (raw.includes("<Stop")) {
        state.stops += 1;
        return reply(200, soap("<tptz:StopResponse></tptz:StopResponse>"));
      }
      if (raw.includes("GetPresets")) {
        return reply(
          200,
          soap(
            "<tptz:GetPresetsResponse>" +
              '<tptz:Preset token="1"><tt:Name>Door</tt:Name><tt:PTZPosition><tt:PanTilt x="0.1" y="0.2"/></tt:PTZPosition></tptz:Preset>' +
              '<tptz:Preset token="2"><tt:Name>المكتب</tt:Name></tptz:Preset>' +
              "</tptz:GetPresetsResponse>"
          )
        );
      }
      if (raw.includes("GotoPreset")) {
        state.gone.push(pick(raw, "PresetToken") ?? "");
        return reply(200, soap("<tptz:GotoPresetResponse></tptz:GotoPresetResponse>"));
      }
      reply(400, soap("<SOAP-ENV:Fault><SOAP-ENV:Reason><SOAP-ENV:Text>Action not supported</SOAP-ENV:Text></SOAP-ENV:Reason></SOAP-ENV:Fault>"));
    });
  });

  await new Promise<void>((resolve) => server.listen(Number(process.env.ONVIF_STAND_IN_PORT ?? 0), "127.0.0.1", resolve));
  state.port = (server.address() as AddressInfo).port;
  state.url = `http://127.0.0.1:${state.port}/onvif/device_service`;
  state.close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return state;
}
