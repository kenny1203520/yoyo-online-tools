"use client";
import { useDirectoryState } from "./directory-state";
import { useI18n } from "@/lib/use-i18n";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { AlignLeft, ArrowDownToLine, ArrowUpRight, CaseSensitive, Crop, Images, ListFilter, Search, ShieldCheck, Sparkles } from "lucide-react";
import { searchTools, tools, type Tool } from "@/lib/tools";

type CategoryFilter = "all" | Tool["category"];



function toolIcon(tool: Tool) {
  if (tool.icon === "resize") return Crop;
  if (tool.icon === "convert") return Images;
  if (tool.icon === "compress") return ArrowDownToLine;
  if (tool.icon === "cleanup") return AlignLeft;
  if (tool.icon === "duplicates") return ListFilter;
  return CaseSensitive;
}

export function ToolDirectory() {
  const { t, locale, href, ready } = useI18n();
  const categories: { id: CategoryFilter; label: string; englishLabel: string }[] = [
  { id: "all", label: t("allTools"), englishLabel: "All tools" },
  { id: "image", label: t("images"), englishLabel: "Images" },
  { id: "text", label: t("text"), englishLabel: "Text" },
];

  const { query, setQuery, category, setCategory } = useDirectoryState();
  const visibleTools = useMemo(
    () => searchTools(query, category),
    [category, query],
  );

  useEffect(() => {
    function syncCategoryFromHash() {
      if (window.location.hash === "#tools") setCategory("all");
      if (window.location.hash === "#image-tools") setCategory("image");
      if (window.location.hash === "#text-tools") setCategory("text");
    }
    syncCategoryFromHash();
    window.addEventListener("hashchange", syncCategoryFromHash);
    return () => window.removeEventListener("hashchange", syncCategoryFromHash);
  }, [setCategory]);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" />{t("usefulToolsForEverydayWork")}</div>
          <h1 id="hero-title">{t("everydayTools")}<br />{t("makeThings")}<span className="headline-accent">{t("simple")}</span></h1>
          <p className="hero-description">{t("getImagesAndTextReadyIn")}</p>
          <form className="search-box" role="search" onSubmit={(event) => event.preventDefault()}>
            <Search size={20} aria-hidden="true" /><label className="sr-only" htmlFor="tool-search">{t("searchToolsOrDescribeYourTask")}</label>
            <input id="tool-search" type="search" disabled={!ready} placeholder={t("searchToolsEgResizeImageOr")} value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" enterKeyHint="search" />
            {query && <button className="search-clear" type="button" onClick={() => setQuery("")}>{t("clearSearch")}</button>}
            <span className="search-shortcut" aria-hidden="true">⌕</span>
          </form>
          <p className="search-locale-note">{t("searchInEnglishOrChineseWhichever")}</p>
          <div className="hero-trust"><ShieldCheck size={15} aria-hidden="true" /><span>{t("yourContentStaysInYourBrowser")}</span><span className="trust-divider" aria-hidden="true" /><span>{t("noSignin")}</span></div>
        </div>
        <div className="hero-art" aria-label={t("exampleYoyoWorkspace")}>
          <div className="art-topline"><span className="art-window-dots"><i /><i /><i /></span><span>{t("yoyoWorkspace")}</span><span className="art-local"><ShieldCheck size={12} />{t("localProcessing")}</span></div>
          <div className="art-workspace">
            <div className="art-image art-original"><div className="art-sun" /><div className="art-hill art-hill-back" /><div className="art-hill art-hill-front" /><span>{t("getStarted")}</span></div>
            <div className="art-transfer" aria-hidden="true"><ArrowUpRight size={16} /></div>
            <div className="art-image art-output"><div className="art-sun" /><div className="art-hill art-hill-back" /><div className="art-hill art-hill-front" /><span>{t("reviewResults")}</span></div>
          </div>
          <div className="art-files"><div className="art-file-icon"><Sparkles size={16} /></div><div className="art-file-copy"><strong>{t("yourContentIsReady")}</strong><span>{t("reviewThenCopyOrDownload")}</span></div><div className="art-saved">{t("youDecide")}</div></div>
        </div>
        <div className="hero-index" aria-hidden="true"><span>YOYO</span><span>01 — {String(tools.length).padStart(2, "0")}</span></div>
      </section>

      <section className="tools-section" id="tools" aria-labelledby="tools-title">
        <div className="section-heading">
          <div><p className="section-kicker">{t("startWithTheEveryday")}</p><h2 id="tools-title">{t("whatWouldYouLikeToDo")}</h2></div>
          <p className="section-aside">{t("imageAndTextToolsReadyTo")}<br />{t("searchInEnglishOrChinese")}</p>
        </div>
        <div className="tool-category-filters" role="group" aria-label={t("filterByToolCategory")}>
          {categories.map((item) => {
            const count = item.id === "all" ? tools.length : tools.filter((tool) => tool.category === item.id).length;
            return <button key={item.id} id={item.id === "image" ? "image-tools" : item.id === "text" ? "text-tools" : undefined} className="tool-category-filter" type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}<span>{count}</span><span className="sr-only">{item.englishLabel}</span></button>;
          })}
        </div>
        {visibleTools.length ? <div className="tool-grid" aria-live="polite">
          {visibleTools.map((tool, index) => { const Icon = toolIcon(tool); return (
            <Link className="tool-card" href={href(tool.href)} key={tool.slug}>
              <span className={`tool-card-number tool-number-${(index % 3) + 1}`}>{String(index + 1).padStart(2, "0")}</span>
              <span className={`tool-icon tool-icon-${tool.slug}`}><Icon size={21} strokeWidth={1.8} /></span>
              <span className="tool-card-content"><strong>{tool.name[locale]}</strong><span>{tool.description[locale]}</span><span className="tool-card-english" lang={locale === "en" ? "zh-TW" : "en"}>{tool.name[locale === "en" ? "zh-TW" : "en"]}</span></span>
              <ArrowUpRight className="tool-arrow" size={18} aria-hidden="true" />
              <span className="tool-local-tag"><ShieldCheck size={12} aria-hidden="true" />{t("inYourBrowser")}</span>
            </Link>
          ); })}
        </div> : <div className="empty-search" role="status"><div className="empty-search-icon"><Search size={19} /></div><p>{t("noToolsFoundForundefined")}{query}{t("closingQuote")}</p><span>{t("tryANameOrTaskIn")}</span><button className="text-button" type="button" onClick={() => { setQuery(""); setCategory("all"); }}>{t("viewAllTools")}</button></div>}
      </section>

      <section className="guide-section" id="guide" aria-labelledby="guide-title">
        <div className="guide-heading"><span className="guide-illustration"><ArrowUpRight size={23} /></span><div><p className="section-kicker">{t("noNewSoftwareToLearn")}</p><h2 id="guide-title">{t("chooseAToolMakeItYours")}</h2></div></div>
        <div className="guide-steps"><article><span className="guide-step-count">01</span><h3>{t("chooseYourTask")}</h3><p>{t("findImageAndTextToolsBy")}</p></article><article><span className="guide-step-count">02</span><h3>{t("addTextOrImages")}</h3><p>{t("pasteTextImportATxtFile")}</p></article><article><span className="guide-step-count">03</span><h3>{t("reviewAndTakeItWithYou")}</h3><p>{t("previewTheResultThenCopyOr")}</p></article></div>
      </section>
      <footer className="site-footer"><Link className="footer-brand" href={href()}>{t("yoyoTools")}</Link><span><ShieldCheck size={14} />{t("yourContentStaysInYourBrowser")}</span><span>{t("lessBusyworkMoreDone")}</span></footer>
    </>
  );
}
