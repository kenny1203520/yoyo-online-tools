// Only released languages belong here; array order is the switcher's display order.
export const localeDefinitions = [
  { code: "zh-TW", nativeName: "繁體中文" },
  { code: "en", nativeName: "English" },
] as const;
export const supportedLocales = localeDefinitions.map(({ code }) => code);
export const defaultLocale = "zh-TW" as const;

export type Locale = (typeof localeDefinitions)[number]["code"];
export type LocalizedText = Record<Locale, string>;

export function isLocale(value: string): value is Locale {
  return supportedLocales.some((locale) => locale === value);
}

export function localePath(locale: Locale, path = "") {
  return `/${locale}${path === "/" ? "" : path}`;
}

export function getLocalizedText(value: LocalizedText, locale: Locale = defaultLocale) {
  return value[locale] ?? value[defaultLocale];
}
