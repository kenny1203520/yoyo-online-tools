export const supportedLocales = ["zh-TW", "en"] as const;
export const defaultLocale = "zh-TW" as const;

export type Locale = (typeof supportedLocales)[number];
export type LocalizedText = Record<Locale, string>;

export function getLocalizedText(value: LocalizedText, locale: Locale = defaultLocale) {
  return value[locale] ?? value[defaultLocale];
}
