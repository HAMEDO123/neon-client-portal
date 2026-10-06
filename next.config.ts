import type { NextConfig } from "next";
import { readFileSync } from "fs";
import path from "path";

// Which deploy this is — **the same answer at build time and at run time**.
//
// This file is read twice: by `next build`, and again by `next start`. The
// Dockerfile used to set NEON_DEPLOY_ID only for the build command, so the
// build baked the id into every page's JavaScript while the running server was
// given none. The two then disagreed about which build this was on every
// single navigation, and Next's answer to a disagreement is a full page reload:
// from 2026-10-03 to 2026-10-06 every link in both portals reloaded the whole
// document, and every server action that refreshed the page wiped whatever was
// on it. Nothing failed, so nothing said so.
//
// So the build writes the id to `.deploy-id` (see the Dockerfile) and both
// readings fall back to that file. `lib/app-version.ts` reads the same file,
// and tests/deploy-id.test.ts pins that the three agree on its name.
function deployId(): string | undefined {
  const fromEnv = process.env.RENDER_GIT_COMMIT || process.env.NEON_DEPLOY_ID;
  if (fromEnv) return fromEnv;
  try {
    return readFileSync(path.join(__dirname, ".deploy-id"), "utf8").trim() || undefined;
  } catch {
    // A build made by hand, or development: no deploy id, and Next falls back
    // to a build id of its own that is new on every build.
    return undefined;
  }
}

const nextConfig: NextConfig = {
  // Which deploy this build is. When the browser's id and the server's differ
  // — a page left open across an update — Next reloads the document on the
  // next navigation instead of mixing two builds' code ("Version Skew" in its
  // self-hosting guide).
  //
  // Render sets RENDER_GIT_COMMIT. **The studio's PC sets nothing**, so the
  // Dockerfile stamps one from the clock at build time — see `deployId` above
  // for why it has to be readable at run time too.
  deploymentId: deployId(),
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    serverActions: {
      // Room for the largest single file (lib/upload-limits.ts MAX_UPLOAD_BYTES,
      // 80 MB) plus what multipart wraps around it. **Cloudflare stops at 100 MB
      // whatever this says** — measured, and the free plan's own limit — so
      // raising this past about 90 MB only moves the failure from a 502 to a
      // 413. The browser checks the size before sending so neither is reached.
      bodySizeLimit: "90mb",
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;
