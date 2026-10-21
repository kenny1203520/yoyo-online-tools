"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/lib/use-i18n";
import { ArrowDownToLine, Menu } from "lucide-react";

export function SiteHeader() {
  const { t, locale, href } = useI18n();
  const pathname = usePathname();
  const router = useRouter();
  function languageHref(next: string) {
    const parts = pathname.split("/");
    parts[1] = next;
    return parts.join("/");
  }
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="skip-link" href="#content" tabIndex={0}>{t("skipContent")}</a>
        <Link className="brand" href={href()} aria-label={t("yoyoTools")}>
          <span className="brand-mark" aria-hidden="true"><ArrowDownToLine size={19} strokeWidth={2.4} /></span>
          <span>YOYO <span className="brand-light">{t("brandSuffix")}</span></span>
        </Link>
        <nav className="desktop-nav" aria-label={t("primaryNav")}><Link href={href("/#tools")}>{t("allTools")}</Link><Link href={href("/#image-tools")}>{t("images")}</Link><Link href={href("/#text-tools")}>{t("text")}</Link><Link href={href("/#guide")}>{t("howItWorks")}</Link></nav>
        <Link className="mobile-nav-link" href={href("/#tools")} aria-label={t("allTools")}><Menu size={20} />{t("allTools")}</Link>
        <nav className="language-nav" aria-label={t("language")}>
          {(["zh-TW", "en"] as const).map((next) => <Link key={next} href={languageHref(next)} lang={next} hrefLang={next} aria-current={next === locale ? "true" : undefined} scroll={false} onClick={(event) => {
            // Preserve a directory search URL or anchor without storing any content.
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.push(languageHref(next) + window.location.search + window.location.hash, { scroll: false });
          }}>{next === "en" ? "English" : "繁體中文"}</Link>)}
        </nav>
      </div>
    </header>
  );
}
