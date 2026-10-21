import type { LocalizedText } from "./i18n";
export type SiteConfig = {
  url: string; indexable: boolean; name: LocalizedText; description: LocalizedText;
  image: Partial<LocalizedText>; imageAlt: LocalizedText;
  verification: { google?: string; bing?: string };
};
export function getSiteConfig(env: Partial<NodeJS.ProcessEnv> = process.env): SiteConfig {
  const input = env.SITE_URL || (env.NODE_ENV !== "production" ? "http://localhost:3000" : "");
  let url: URL;
  try { url = new URL(input); } catch { throw new Error("SITE_URL must be an absolute http(s) origin, e.g. https://tools.example.com"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("SITE_URL must be an http(s) origin without credentials, a subpath, query or fragment");
  }
  if (env.SITE_INDEXABLE && !["true", "false"].includes(env.SITE_INDEXABLE)) throw new Error("SITE_INDEXABLE must be true or false");
  for (const value of [env.SITE_OG_IMAGE_ZH_TW, env.SITE_OG_IMAGE_EN]) {
    if (value && !/^https?:\/\//.test(value)) throw new Error("Share images must use absolute http(s) URLs");
  }
  return {
    url: url.origin, indexable: env.SITE_INDEXABLE === "true",
    name: { "zh-TW": env.SITE_NAME_ZH_TW || "YOYO 工具站", en: env.SITE_NAME_EN || "YOYO Tools" },
    description: {
      "zh-TW": env.SITE_DESCRIPTION_ZH_TW || "在瀏覽器裡整理圖片與文字。免登入、不需上傳，支援繁體中文與英文搜尋。",
      en: env.SITE_DESCRIPTION_EN || "Prepare images and text in your browser. No sign-in or uploads. Search tools in English or Chinese.",
    },
    image: { "zh-TW": env.SITE_OG_IMAGE_ZH_TW, en: env.SITE_OG_IMAGE_EN },
    imageAlt: {
      "zh-TW": env.SITE_OG_ALT_ZH_TW || "YOYO 工具站：圖片與文字，在瀏覽器輕鬆整理",
      en: env.SITE_OG_ALT_EN || "YOYO Tools: everyday image and text tools in your browser",
    },
    verification: { google: env.GOOGLE_SITE_VERIFICATION, bing: env.BING_SITE_VERIFICATION },
  };
}
