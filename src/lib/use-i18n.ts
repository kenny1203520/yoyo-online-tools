"use client";
import { useLocale, useTranslations } from "next-intl";
import { useSyncExternalStore } from "react";
import { localePath, type Locale } from "./i18n";
import type { MessageKey, MessageRef, MessageArguments } from "./messages";
export function useI18n() {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const locale = useLocale() as Locale;
  const translate = useTranslations();
  const t = <Key extends MessageKey>(key: Key, ...args: MessageArguments<Key>) => translate(String(key), args[0]);
  const renderMessage = (value: MessageRef | null) => value ? translate(value.key, value.values) : "";
  return { locale, t, renderMessage, ready, href: (path = "") => localePath(locale, path) };
}
const subscribe = () => () => {};
