// Only released languages belong here; array order is the switcher's display order.
export const localeDefinitions = [
  { code: "zh-TW", nativeName: "繁體中文", englishName: "Traditional Chinese", aliases: ["中文", "繁中", "正體中文", "繁体中文"] },
  { code: "en", nativeName: "English", englishName: "English", aliases: ["英文", "英語", "英语"] },
] as const;
export const supportedLocales = localeDefinitions.map(({ code }) => code);
export const defaultLocale = "zh-TW" as const;

export type Locale = (typeof localeDefinitions)[number]["code"];
export type LocalizedText = Record<Locale, string>;

export function searchLocales(query: string) {
  const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[_-]/g, " ").trim();
  const words = normalize(query).split(/\s+/).filter(Boolean);
  return localeDefinitions.filter(({ code, nativeName, englishName, aliases }) => {
    const text = normalize([code, nativeName, englishName, ...aliases].join(" "));
    return words.every((word) => text.includes(word));
  });
}

export function isLocale(value: string): value is Locale {
  return supportedLocales.some((locale) => locale === value);
}

export function localePath(locale: Locale, path = "") {
  return `/${locale}${path === "/" ? "" : path}`;
}

export function getLocalizedText(value: LocalizedText, locale: Locale = defaultLocale) {
  return value[locale] ?? value[defaultLocale];
}
