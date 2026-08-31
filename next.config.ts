import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
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
