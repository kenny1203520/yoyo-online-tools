"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/use-i18n";
import { ArrowDownToLine, Menu } from "lucide-react";
import { LanguageSwitcher } from "./language-switcher";

export function SiteHeader() {
  const { t, href } = useI18n();
  const pathname = usePathname();
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
        <LanguageSwitcher key={pathname} />
      </div>
    </header>
  );
}
