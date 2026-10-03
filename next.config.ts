import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Which deploy this build is. A page left open across an update otherwise
  // calls the server with the old build's action ids, and Next answers
  // something the page cannot read: **"An unexpected response was received
  // from the server"**, which is what an upload on a stale project tab looked
  // like. Next's own self-hosting guide names it — "Server Function
  // mismatches" under Version Skew — and an id is its answer: the page
  // reloads itself instead of failing.
  //
  // Render sets RENDER_GIT_COMMIT. **The studio's PC sets nothing**, which is
  // why every deploy there broke every open page until somebody reloaded it,
  // and why the Dockerfile now stamps NEON_DEPLOY_ID at build time rather than
  // leaving it to a flag somebody has to remember.
  deploymentId: process.env.RENDER_GIT_COMMIT || process.env.NEON_DEPLOY_ID || undefined,
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    serverActions: {
      // Gallery images now upload one file per request (see ImageUploadForm), so this only
      // needs to cover the single largest upload: a 50MB document/video (see storage.ts RULES).
      bodySizeLimit: "60mb",
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;
