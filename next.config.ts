import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Which deploy this build is. A page left open across an update would
  // otherwise call the server with the old build's actions and fail — the
  // chat's send, for one. With an id, Next.js sees the mismatch and reloads
  // the page instead. Render sets RENDER_GIT_COMMIT at build time and at run
  // time; locally it is unset and nothing changes.
  deploymentId: process.env.RENDER_GIT_COMMIT || undefined,
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
