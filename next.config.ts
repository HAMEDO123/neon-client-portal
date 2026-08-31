import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  experimental: {
    serverActions: {
      // Batch gallery uploads send several images in one request before server-side compression runs.
      // Kept well under Render's free-tier 512MB RAM ceiling — this is the raw upload, before compression.
      bodySizeLimit: "100mb",
    },
  },
  images: {
    remotePatterns: [{ protocol: "https", hostname: "*.public.blob.vercel-storage.com" }],
  },
};

export default nextConfig;
