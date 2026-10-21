"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Check, ChevronDown, Globe, Search, X } from "lucide-react";
import { localeDefinitions, searchLocales, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/use-i18n";

export function LanguageSwitcher() {
  const { t, locale, ready } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const dialogId = useId();
  const headingId = useId();
  const searchId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const startedOnBackdrop = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [suffix, setSuffix] = useState("");
  const current = localeDefinitions.find(({ code }) => code === locale)!;
  const languages = searchLocales(query);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    root.style.overflow = "hidden";
    return () => { root.style.overflow = previousOverflow; };
  }, [open]);

  function languageHref(next: Locale) {
    const parts = pathname.split("/");
    parts[1] = next;
    return parts.join("/");
  }

  function isBackdrop(event: MouseEvent<HTMLDialogElement> | PointerEvent<HTMLDialogElement>) {
    if (event.target !== event.currentTarget) return false;
    const rect = event.currentTarget.getBoundingClientRect();
    return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
  }

  return (
    <div className="language-switcher">
      <button ref={trigger} className="language-trigger" type="button" disabled={!ready} tabIndex={0}
        aria-label={t("changeLanguage", { language: current.nativeName })}
        aria-haspopup="dialog" aria-expanded={open} aria-controls={dialogId}
        onClick={() => {
          // Establish the return target consistently, including pointer use in Safari.
          trigger.current?.focus();
          setQuery("");
          setSuffix(window.location.search + window.location.hash);
          dialog.current?.showModal();
          setOpen(true);
          searchInput.current?.focus();
        }}>
        <Globe size={20} aria-hidden="true" />
        <ChevronDown className="language-chevron" size={14} aria-hidden="true" />
      </button>
      <dialog ref={dialog} id={dialogId} className="language-dialog" aria-labelledby={headingId}
        {...{ closedby: "any" }}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus();
        }}
        onPointerDown={(event) => { startedOnBackdrop.current = isBackdrop(event); }}
        onClick={(event) => {
          // Safari needs manual light-dismiss. A drag starting inside must not close it.
          if (!("closedBy" in HTMLDialogElement.prototype) && startedOnBackdrop.current && isBackdrop(event)) {
            event.currentTarget.close();
          }
          startedOnBackdrop.current = false;
        }}>
        <div className="language-dialog-heading">
          <div className="language-dialog-icon"><Globe size={22} aria-hidden="true" /></div>
          <div>
            <h2 id={headingId}>{t("chooseLanguage")}</h2>
            <p>{t("languagePickerDescription")}</p>
          </div>
          <button type="button" className="language-close" tabIndex={0} aria-label={t("closeLanguagePicker")}
            onClick={() => dialog.current?.close()}><X size={20} aria-hidden="true" /></button>
        </div>
        <search className="language-search">
          <label className="sr-only" htmlFor={searchId}>{t("searchLanguages")}</label>
          <Search size={19} aria-hidden="true" />
          <input ref={searchInput} id={searchId} type="search" value={query} placeholder={t("searchLanguagesPlaceholder")}
            onChange={(event) => setQuery(event.target.value)} spellCheck={false} />
          {query && <button type="button" className="language-clear" tabIndex={0} aria-label={t("clearLanguageSearch")}
            onClick={() => { setQuery(""); searchInput.current?.focus(); }}><X size={16} aria-hidden="true" /></button>}
        </search>
        <p className="language-result-count" role="status" aria-live="polite" aria-atomic="true">
          {t("languageResultCount", { count: languages.length })}
        </p>
        <div className="language-results">
          {languages.length ? (
            <ul className="language-grid">
              {languages.map(({ code, nativeName, englishName }) => (
                <li key={code}>
                  <Link href={languageHref(code) + suffix} lang={code} hrefLang={code} scroll={false} tabIndex={0}
                    aria-current={code === locale ? "true" : undefined}
                    onClick={(event) => {
                      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                      event.preventDefault();
                      dialog.current?.close();
                      if (code !== locale) {
                        router.push(languageHref(code) + window.location.search + window.location.hash, { scroll: false });
                      }
                    }}>
                    <span className="language-option-copy">
                      <span className="language-native-name" dir="auto">{nativeName}</span>
                      <span className="language-option-detail" lang="en" dir="ltr">
                        {englishName !== nativeName && <>{englishName} · </>}{code}
                      </span>
                    </span>
                    {code === locale && <span className="language-current-mark"><Check size={17} aria-hidden="true" /></span>}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="language-no-results">
              <Search size={25} aria-hidden="true" />
              <h3>{t("noLanguagesFound")}</h3>
              <p>{t("tryLanguageSearchAgain")}</p>
              <button type="button" tabIndex={0} onClick={() => { setQuery(""); searchInput.current?.focus(); }}>{t("clearLanguageSearch")}</button>
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}
