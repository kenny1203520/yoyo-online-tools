"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlignLeft, ArrowDownToLine, ArrowUpRight, CaseSensitive, Crop, Images, ListFilter, Search, ShieldCheck, Sparkles } from "lucide-react";
import { matchesTool, tools, type Tool } from "@/lib/tools";

type CategoryFilter = "all" | Tool["category"];

const categories: { id: CategoryFilter; label: string; englishLabel: string }[] = [
  { id: "all", label: "全部工具", englishLabel: "All tools" },
  { id: "image", label: "圖片", englishLabel: "Images" },
  { id: "text", label: "文字", englishLabel: "Text" },
];

function toolIcon(tool: Tool) {
  if (tool.icon === "resize") return Crop;
  if (tool.icon === "convert") return Images;
  if (tool.icon === "compress") return ArrowDownToLine;
  if (tool.icon === "cleanup") return AlignLeft;
  if (tool.icon === "duplicates") return ListFilter;
  return CaseSensitive;
}

export function ToolDirectory() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const visibleTools = useMemo(
    () => tools.filter((tool) => (category === "all" || tool.category === category) && matchesTool(tool, query)),
    [category, query],
  );

  useEffect(() => {
    function syncCategoryFromHash() {
      if (window.location.hash === "#image-tools") setCategory("image");
      if (window.location.hash === "#text-tools") setCategory("text");
    }
    syncCategoryFromHash();
    window.addEventListener("hashchange", syncCategoryFromHash);
    return () => window.removeEventListener("hashchange", syncCategoryFromHash);
  }, []);

  return (
    <>
      <section className="hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="eyebrow"><span className="eyebrow-dot" />為日常工作整理好工具</div>
          <h1 id="hero-title">日常工具，<br />讓繁瑣變得<span className="headline-accent">簡單。</span></h1>
          <p className="hero-description">圖片、文字都能快速整理。選一件想完成的事，交給 YOYO。</p>
          <form className="search-box" role="search" onSubmit={(event) => event.preventDefault()}>
            <Search size={20} aria-hidden="true" /><label className="sr-only" htmlFor="tool-search">搜尋工具或輸入想完成的事</label>
            <input id="tool-search" type="search" placeholder="搜尋工具，例如「照片太大」或 “resize image”" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" enterKeyHint="search" />
            {query && <button className="search-clear" type="button" onClick={() => setQuery("")}>清除</button>}
            <span className="search-shortcut" aria-hidden="true">⌕</span>
          </form>
          <p className="search-locale-note">使用繁體中文介面，也能用英文搜尋圖片與文字工具。</p>
          <div className="hero-trust"><ShieldCheck size={15} aria-hidden="true" /><span>內容只在你的瀏覽器裡處理</span><span className="trust-divider" aria-hidden="true" /><span>免登入</span></div>
        </div>
        <div className="hero-art" aria-label="YOYO 工具工作區示意圖">
          <div className="art-topline"><span className="art-window-dots"><i /><i /><i /></span><span>YOYO 工作區</span><span className="art-local"><ShieldCheck size={12} />本機處理</span></div>
          <div className="art-workspace">
            <div className="art-image art-original"><div className="art-sun" /><div className="art-hill art-hill-back" /><div className="art-hill art-hill-front" /><span>開始整理</span></div>
            <div className="art-transfer" aria-hidden="true"><ArrowUpRight size={16} /></div>
            <div className="art-image art-output"><div className="art-sun" /><div className="art-hill art-hill-back" /><div className="art-hill art-hill-front" /><span>結果確認</span></div>
          </div>
          <div className="art-files"><div className="art-file-icon"><Sparkles size={16} /></div><div className="art-file-copy"><strong>內容已準備好</strong><span>檢查結果再複製或下載</span></div><div className="art-saved">由你確認</div></div>
        </div>
        <div className="hero-index" aria-hidden="true"><span>YOYO</span><span>01 — {String(tools.length).padStart(2, "0")}</span></div>
      </section>

      <section className="tools-section" id="tools" aria-labelledby="tools-title">
        <div className="section-heading">
          <div><p className="section-kicker">先從日常開始</p><h2 id="tools-title">你想完成哪一件事？</h2></div>
          <p className="section-aside">目前提供圖片與文字工具<br />搜尋也支援英文說法</p>
        </div>
        <div className="tool-category-filters" role="group" aria-label="依工具類別篩選">
          {categories.map((item) => {
            const count = item.id === "all" ? tools.length : tools.filter((tool) => tool.category === item.id).length;
            return <button key={item.id} id={item.id === "image" ? "image-tools" : item.id === "text" ? "text-tools" : undefined} className="tool-category-filter" type="button" aria-pressed={category === item.id} onClick={() => setCategory(item.id)}>{item.label}<span>{count}</span><span className="sr-only">{item.englishLabel}</span></button>;
          })}
        </div>
        {visibleTools.length ? <div className="tool-grid" aria-live="polite">
          {visibleTools.map((tool, index) => { const Icon = toolIcon(tool); return (
            <Link className="tool-card" href={tool.href} key={tool.slug}>
              <span className={`tool-card-number tool-number-${(index % 3) + 1}`}>{String(index + 1).padStart(2, "0")}</span>
              <span className={`tool-icon tool-icon-${tool.slug}`}><Icon size={21} strokeWidth={1.8} /></span>
              <span className="tool-card-content"><strong>{tool.name["zh-TW"]}</strong><span>{tool.description["zh-TW"]}</span><span className="tool-card-english" lang="en">{tool.name.en}</span></span>
              <ArrowUpRight className="tool-arrow" size={18} aria-hidden="true" />
              <span className="tool-local-tag"><ShieldCheck size={12} aria-hidden="true" />瀏覽器內處理</span>
            </Link>
          ); })}
        </div> : <div className="empty-search" role="status"><div className="empty-search-icon"><Search size={19} /></div><p>找不到「{query}」相關工具</p><span>試試英文名稱或用途，例如 “clean text”，或切換工具類別。</span><button className="text-button" type="button" onClick={() => { setQuery(""); setCategory("all"); }}>查看全部工具</button></div>}
      </section>

      <section className="guide-section" id="guide" aria-labelledby="guide-title">
        <div className="guide-heading"><span className="guide-illustration"><ArrowUpRight size={23} /></span><div><p className="section-kicker">不需要學新軟體</p><h2 id="guide-title">選好工具，整理好再帶走。</h2></div></div>
        <div className="guide-steps"><article><span className="guide-step-count">01</span><h3>選擇想完成的事</h3><p>搜尋圖片與文字工具，也能直接輸入英文名稱或用途。</p></article><article><span className="guide-step-count">02</span><h3>輸入內容或加入圖片</h3><p>依照工具提示貼上文字、匯入 TXT，或加入圖片。</p></article><article><span className="guide-step-count">03</span><h3>確認結果再帶走</h3><p>預覽整理結果，再複製或下載到你的裝置。</p></article></div>
      </section>
      <footer className="site-footer"><Link className="footer-brand" href="/">YOYO 工具站</Link><span><ShieldCheck size={14} />內容只在你的瀏覽器裡處理</span><span>為日常工作，少一點繁瑣。</span></footer>
    </>
  );
}
