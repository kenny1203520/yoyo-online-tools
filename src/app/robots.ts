import type { MetadataRoute } from "next";
import { getSiteConfig } from "@/lib/site-config";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots {
  const config = getSiteConfig();
  return config.indexable ? { rules: { userAgent: "*", allow: "/", disallow: "/api/" }, sitemap: `${config.url}/sitemap.xml` }
    : { rules: { userAgent: "*", disallow: "/" } };
}
