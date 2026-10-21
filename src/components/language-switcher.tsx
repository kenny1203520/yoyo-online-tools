"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Globe } from "lucide-react";
import { localeDefinitions, type Locale } from "@/lib/i18n";
import { useI18n } from "@/lib/use-i18n";

export function LanguageSwitcher() {
  const { t, locale, ready } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  const panelId = useId();
  const root = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [suffix, setSuffix] = useState("");
  const current = localeDefinitions.find(({ code }) => code === locale)!;
  const label = t("changeLanguage", { language: current.nativeName });

  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);

  function languageHref(next: Locale) {
    const parts = pathname.split("/");
    parts[1] = next;
    return parts.join("/");
  }

  function closeAndFocus() {
    setOpen(false);
    trigger.current?.focus();
  }

  return (
    <nav ref={root} className="language-switcher" aria-label={t("language")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (open && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          closeAndFocus();
        }
      }}>
      <button ref={trigger} className="language-trigger" type="button" disabled={!ready}
        aria-label={label} title={label} aria-expanded={open} aria-controls={panelId}
        onClick={() => {
          // Safari does not focus buttons on pointer activation by default.
          trigger.current?.focus();
          setSuffix(window.location.search + window.location.hash);
          setOpen((value) => !value);
        }}>
        <Globe size={20} aria-hidden="true" />
        <ChevronDown className="language-chevron" size={14} aria-hidden="true" />
      </button>
      <div id={panelId} className="language-panel" hidden={!open}>
        <p className="language-panel-title">{t("language")}</p>
        <ul>
          {localeDefinitions.map(({ code, nativeName }) => (
            <li key={code}>
              <Link href={languageHref(code) + suffix} lang={code} hrefLang={code} scroll={false} tabIndex={0}
                aria-current={code === locale ? "true" : undefined}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  closeAndFocus();
                  if (code !== locale) {
                    router.push(languageHref(code) + window.location.search + window.location.hash, { scroll: false });
                  }
                }}>
                <span>{nativeName}</span>
                {code === locale && <Check size={17} aria-hidden="true" />}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
