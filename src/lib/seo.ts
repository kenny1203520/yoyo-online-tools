import type { Metadata, MetadataRoute } from "next";
import { defaultLocale, localePath, supportedLocales, type Locale } from "./i18n";
import { getSiteConfig, type SiteConfig } from "./site-config";
import { tools, type Tool } from "./tools";

function alternatives(config: SiteConfig, path = "") {
  return Object.fromEntries([...supportedLocales.map((locale) => [locale, config.url + localePath(locale, path)]), ["x-default", config.url + localePath(defaultLocale, path)]]);
}
export function pageMetadata(locale: Locale, tool?: Tool): Metadata {
  const config = getSiteConfig();
  const path = tool?.href ?? "";
  const title = tool ? `${tool.name[locale]}｜${config.name[locale]}` : config.name[locale];
  const description = tool ? `${tool.description[locale]} ${locale === "en" ? "Processed in your browser. No uploads or sign-in." : "只在瀏覽器處理，免登入、不需上傳。"}` : config.description[locale];
  const canonical = config.url + localePath(locale, path);
  const image = { url: config.image[locale] || `${config.url}/${locale}/share-image`, width: 1200, height: 630, alt: config.imageAlt[locale] };
  return {
    metadataBase: new URL(config.url), title, description, applicationName: config.name[locale],
    keywords: tool ? [...Object.values(tool.name), ...Object.values(tool.searchTerms).flat()] : undefined,
    alternates: { canonical, languages: alternatives(config, path) },
    robots: { index: config.indexable, follow: config.indexable },
    openGraph: { type: "website", title, description, url: canonical, siteName: config.name[locale], locale: locale === "en" ? "en_US" : "zh_TW", alternateLocale: locale === "en" ? ["zh_TW"] : ["en_US"], images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
    verification: { google: config.verification.google, other: config.verification.bing ? { "msvalidate.01": config.verification.bing } : undefined },
  };
}
export function sitemapEntries(config = getSiteConfig()): MetadataRoute.Sitemap {
  if (!config.indexable) return [];
  return ["", ...tools.map((tool) => tool.href)].flatMap((path) => supportedLocales.map((locale) => ({
    url: config.url + localePath(locale, path), alternates: { languages: alternatives(config, path) },
  })));
}
export function structuredData(locale: Locale, tool?: Tool) {
  const config = getSiteConfig();
  const home = config.url + localePath(locale);
  const url = config.url + localePath(locale, tool?.href ?? "");
  const website = { "@type": "WebSite", "@id": `${home}#website`, url: home, name: config.name[locale], description: config.description[locale], inLanguage: locale };
  return { "@context": "https://schema.org", "@graph": tool ? [website, {
    "@type": "WebApplication", "@id": `${url}#application`, url, name: tool.name[locale], description: tool.description[locale],
    inLanguage: locale, applicationCategory: "UtilitiesApplication", operatingSystem: "Any", browserRequirements: "Requires JavaScript",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" }, isPartOf: { "@id": `${home}#website` },
  }, { "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: config.name[locale], item: home },
    { "@type": "ListItem", position: 2, name: tool.name[locale], item: url },
  ] }] : [website] };
}
