// Makes (or refreshes) the two manual App Store profiles the upload signs
// with — the app and its share extension — through the App Store Connect API,
// using the team's Apple Distribution certificate in this Mac's keychain.
//
// Why manual: the team's API key has the App Manager role, which may not use
// Xcode's cloud signing, and the Xcode account here is not in the developer
// team — so automatic signing could not make a profile for the new extension.
//
//   ASC_KEY_ID=… ASC_ISSUER_ID=… \
//   LOCAL_SERIAL=$(security find-certificate -c "Apple Distribution" -p | openssl x509 -serial -noout | cut -d= -f2) \
//     node tools/asc-profiles.mjs
//
// The key file is read from ~/.appstoreconnect/private_keys/AuthKey_<id>.p8.
// Nothing secret is printed or written anywhere but the profiles folder.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const keyId = process.env.ASC_KEY_ID;
const issuer = process.env.ASC_ISSUER_ID;
if (!keyId || !issuer) throw new Error("Set ASC_KEY_ID and ASC_ISSUER_ID.");
const keyPath = path.join(os.homedir(), `.appstoreconnect/private_keys/AuthKey_${keyId}.p8`);
const localSerial = (process.env.LOCAL_SERIAL || "").replace(/^0+/, "").toUpperCase();

function token() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: "ES256", kid: keyId, typ: "JWT" })}.${b64({ iss: issuer, iat: now, exp: now + 1200, aud: "appstoreconnect-v1" })}`;
  const sig = crypto.sign("sha256", Buffer.from(input), { key: fs.readFileSync(keyPath, "utf8"), dsaEncoding: "ieee-p1363" });
  return `${input}.${sig.toString("base64url")}`;
}

async function api(method, url, body) {
  const res = await fetch(`https://api.appstoreconnect.apple.com${url}`, {
    method,
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${JSON.stringify(json.errors?.map((e) => e.detail || e.title))}`);
  return json;
}

const certs = (await api("GET", "/v1/certificates?limit=200")).data;
const cert = certs.filter((c) => /DISTRIBUTION/.test(c.attributes.certificateType))
  .find((c) => (c.attributes.serialNumber || "").replace(/^0+/, "").toUpperCase() === localSerial);
if (!cert) throw new Error("the local Apple Distribution certificate is not among the team's certificates");

async function ensureProfile(identifier, bundleName, profileName) {
  let bundle = (await api("GET", `/v1/bundleIds?filter[identifier]=${identifier}&limit=5`)).data.find((b) => b.attributes.identifier === identifier);
  if (!bundle) {
    bundle = (await api("POST", "/v1/bundleIds", {
      data: { type: "bundleIds", attributes: { identifier, name: bundleName, platform: "IOS" } },
    })).data;
    console.log("registered bundle id", identifier);
  }
  const existing = (await api("GET", `/v1/bundleIds/${bundle.id}/profiles?limit=50`)).data
    .filter((p) => p.attributes.profileType === "IOS_APP_STORE" && p.attributes.profileState === "ACTIVE" && p.attributes.name === profileName);
  let profile = existing[0];
  if (!profile) {
    profile = (await api("POST", "/v1/profiles", {
      data: {
        type: "profiles",
        attributes: { name: profileName, profileType: "IOS_APP_STORE" },
        relationships: {
          bundleId: { data: { type: "bundleIds", id: bundle.id } },
          certificates: { data: [{ type: "certificates", id: cert.id }] },
        },
      },
    })).data;
    console.log("created profile:", profileName);
  }
  const dir = path.join(os.homedir(), "Library/MobileDevice/Provisioning Profiles");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${profile.attributes.uuid}.mobileprovision`), Buffer.from(profile.attributes.profileContent, "base64"));
  console.log("installed:", profileName, profile.attributes.uuid);
}

await ensureProfile("com.neonjo.staff", "NEON", "NEON App Store");
await ensureProfile("com.neonjo.staff.share", "NEON Share", "NEON Share App Store");
