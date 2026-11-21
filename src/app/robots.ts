import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    // The portal stays private; only the public privacy policy may be crawled
    // (Meta checks the Privacy Policy URL of the NEON Ads app).
    rules: { userAgent: "*", allow: "/privacy", disallow: "/" },
  };
}
