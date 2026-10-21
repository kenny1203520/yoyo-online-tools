"use client";

import Image from "next/image";
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArrowDown, ArrowLeftRight, Check, CircleAlert, FileImage, ImagePlus, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { getImageTool, getImageTools, localized, type ImageTool } from "@/lib/tools";
import { effectiveSettings, fileExtension, formatBytes, formatLabel, ImageEntry, ImageSettings, inspectImage, MAX_FILES, MAX_FILE_BYTES, processImage, safeFileName, settingsKey, supportsOutputFormat } from "@/lib/image-processing";

const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

function initialSettings(tool: ImageTool): ImageSettings {
  return { format: tool.format === "image-convert" ? "image/webp" : "same", quality: 0.82, maxWidth: null, maxHeight: null };
}

function isResultCurrent(entry: ImageEntry, base: ImageSettings) {
  return Boolean(entry.result && entry.result.settingsKey === settingsKey(effectiveSettings(base, entry.overrides), entry.mime));
}

export function ImageWorkspace({ tool }: { tool: ImageTool }) {
  const [activeTool, setActiveTool] = useState(tool);
  const [items, setItems] = useState<ImageEntry[]>([]);
  const [settings, setSettings] = useState(() => initialSettings(tool));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultUrls, setResultUrls] = useState<Map<string, string>>(() => new Map());
  const [rejected, setRejected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [compareOutput, setCompareOutput] = useState(true);
  const [isWebpExportAvailable, setIsWebpExportAvailable] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const mountedRef = useRef(false);
  const urlsRef = useRef(new Set<string>());

  useEffect(() => {
    function syncToolFromUrl() {
      const slug = window.location.pathname.split("/").pop() ?? "";
      const nextTool = getImageTool(slug);
      if (nextTool) setActiveTool(nextTool);
    }
    window.addEventListener("popstate", syncToolFromUrl);
    return () => window.removeEventListener("popstate", syncToolFromUrl);
  }, []);

  useEffect(() => {
    document.title = `${localized(activeTool.name)}｜YOYO 工具站`;
  }, [activeTool]);
  useEffect(() => {
    mountedRef.current = true;
    const activeUrls = urlsRef.current;
    return () => {
      mountedRef.current = false;
      stopRef.current = true;
      for (const url of activeUrls) URL.revokeObjectURL(url);
      activeUrls.clear();
    };
  }, []);

  useEffect(() => {
    let current = true;
    void supportsOutputFormat("image/webp").then((supported) => {
      if (!current) return;
      setIsWebpExportAvailable(supported);
      if (!supported && tool.format === "image-convert") {
        setSettings((previous) => ({ ...previous, format: "same" }));
        setNotice("目前瀏覽器無法輸出 WebP，已預設保留圖片原格式。你仍可選擇其他支援的格式。");
      }
    });
    return () => { current = false; };
  }, [tool]);

  const activeItem = items.find((item) => item.id === activeId) ?? items[0] ?? null;
  const activeIsCurrent = activeItem ? isResultCurrent(activeItem, settings) : false;
  const readyCount = items.filter((item) => item.status === "ready" || item.status === "error" || (item.status === "done" && !isResultCurrent(item, settings))).length;
  const doneCount = items.filter((item) => isResultCurrent(item, settings)).length;
  const isFormatDisabled = settings.format === "image/webp" && !isWebpExportAvailable;

  const addFiles = useCallback(async (selected: FileList | File[]) => {
    const incoming = Array.from(selected);
    if (incoming.length === 0) return;
    setRejected([]);
    setNotice("");
    const slots = Math.max(0, MAX_FILES - items.length);
    const candidates = incoming.slice(0, slots);
    const nextRejected: string[] = incoming.length > slots ? [`每批最多加入 ${MAX_FILES} 張圖片。超出的檔案未加入。`] : [];
    const accepted: ImageEntry[] = [];
    for (const file of candidates) {
      try {
        const dimensions = await inspectImage(file);
        if (!mountedRef.current) return;
        const previewUrl = URL.createObjectURL(file);
        urlsRef.current.add(previewUrl);
        accepted.push({ id: crypto.randomUUID(), file, previewUrl, mime: dimensions.mime, width: dimensions.width, height: dimensions.height, overrides: {}, status: "ready" });
      } catch (error) {
        nextRejected.push(`${file.name}：${error instanceof Error ? error.message : "無法讀取這個檔案。"}`);
      }
    }
    if (!mountedRef.current) return;
    if (accepted.length) {
      setItems((current) => [...current, ...accepted].slice(0, MAX_FILES));
      setActiveId((current) => current ?? accepted[0]?.id ?? null);
      setNotice(`已加入 ${accepted.length} 張圖片，檔案留在目前的瀏覽器工作階段。`);
    }
    setRejected(nextRejected);
    if (!accepted.length && !nextRejected.length) setNotice("沒有加入新的圖片。");
  }, [items.length]);

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void addFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (event.dataTransfer.files.length) void addFiles(event.dataTransfer.files);
  }

  function updateOverride<K extends keyof ImageSettings>(id: string, key: K, value: ImageSettings[K]) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, overrides: { ...item.overrides, [key]: value } } : item));
  }

  function updateBatchSetting<K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function switchTool(nextTool: ImageTool) {
    if (nextTool.slug === activeTool.slug) return;
    window.history.pushState(null, "", nextTool.href);
    setActiveTool(nextTool);
    if (nextTool.format === "image-convert") {
      setSettings((current) => ({ ...current, format: isWebpExportAvailable ? "image/webp" : "same" }));
    }
    setNotice(`已切換到「${nextTool.name}」，目前圖片和設定已保留。`);
  }

  function releaseOutput(id: string) {
    const url = resultUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      urlsRef.current.delete(url);
      setResultUrls((current) => { const next = new Map(current); next.delete(id); return next; });
    }
  }

  function removeImage(id: string) {
    releaseOutput(id);
    const original = items.find((item) => item.id === id)?.previewUrl;
    if (original) { URL.revokeObjectURL(original); urlsRef.current.delete(original); }
    setItems((current) => {
      const next = current.filter((item) => item.id !== id);
      if (id === activeId) setActiveId(next[0]?.id ?? null);
      return next;
    });
    if (expandedId === id) setExpandedId(null);
    setNotice("已移除圖片。");
  }

  async function processBatch() {
    if (isProcessing || !readyCount) return;
    stopRef.current = false;
    setIsProcessing(true);
    setRejected([]);
    setNotice("正在依序處理圖片。你可以隨時停止後續項目。");
    const snapshot = [...items];
    const queue = snapshot.filter((item) => item.status === "ready" || item.status === "error" || (item.status === "done" && !isResultCurrent(item, settings)));
    setItems((current) => current.map((item) => queue.some((queued) => queued.id === item.id) ? { ...item, status: "queued", error: undefined } : item));
    for (const item of queue) {
      if (stopRef.current) break;
      const currentItem = items.find((candidate) => candidate.id === item.id) ?? item;
      const effective = effectiveSettings(settings, currentItem.overrides);
      setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "processing", error: undefined } : candidate));
      releaseOutput(item.id);
      try {
        const result = await processImage(currentItem, effective);
        if (!mountedRef.current) break;
        const url = URL.createObjectURL(result.blob);
        urlsRef.current.add(url);
        setResultUrls((current) => new Map(current).set(item.id, url));
        setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "done", result, error: undefined } : candidate));
      } catch (error) {
        if (!mountedRef.current) break;
        const message = error instanceof Error ? error.message : "圖片處理失敗。請再試一次。";
        setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", error: message } : candidate));
      }
    }
    if (!mountedRef.current) return;
    setItems((current) => current.map((item) => item.status === "queued" ? { ...item, status: "ready" } : item));
    setIsProcessing(false);
    setNotice(stopRef.current ? "已停止後續處理，已完成的圖片仍可下載。" : "圖片處理已完成。可先檢查結果，再下載檔案。");
  }

  function downloadItem(item: ImageEntry) {
    if (!isResultCurrent(item, settings)) return;
    const blob = item.result!.blob;
    const extension = fileExtension(item.result!.mime);
    const baseName = safeFileName(item.file.name).replace(/\.[^.]*$/, "") || "image";
    const href = URL.createObjectURL(blob);
    urlsRef.current.add(href);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${baseName}-yoyo.${extension}`;
    anchor.click();
    window.setTimeout(() => { URL.revokeObjectURL(href); urlsRef.current.delete(href); }, 1000);
  }

  async function downloadZip() {
    const completed = items.filter((item) => isResultCurrent(item, settings));
    if (!completed.length || isZipping) return;
    setIsZipping(true);
    setNotice("正在準備 ZIP 檔案。");
    try {
      const { default: JSZip } = await import("jszip");
      const zip = new JSZip();
      const used = new Set<string>();
      for (const item of completed) {
        const result = item.result!;
        const stem = safeFileName(item.file.name).replace(/\.[^.]*$/, "") || "image";
        const extension = fileExtension(result.mime);
        let name = `${stem}-yoyo.${extension}`;
        let suffix = 2;
        while (used.has(name)) name = `${stem}-yoyo-${suffix++}.${extension}`;
        used.add(name);
        zip.file(name, result.blob);
      }
      const blob = await zip.generateAsync({ type: "blob", compression: "STORE", mimeType: "application/zip" });
      if (!mountedRef.current) return;
      const href = URL.createObjectURL(blob);
      urlsRef.current.add(href);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "yoyo-images.zip";
      anchor.click();
      window.setTimeout(() => { URL.revokeObjectURL(href); urlsRef.current.delete(href); }, 1500);
      setNotice(`已準備 ${completed.length} 張圖片的 ZIP 檔案。`);
    } catch {
      setNotice("ZIP 檔案建立失敗。你仍可逐張下載已完成的圖片。");
    } finally {
      if (mountedRef.current) setIsZipping(false);
    }
  }

  function clearImages() {
    for (const url of urlsRef.current) {
      URL.revokeObjectURL(url);
    }
    urlsRef.current.clear();
    setItems([]);
    setResultUrls(new Map());
    setActiveId(null);
    setExpandedId(null);
    setRejected([]);
    setNotice("已清空圖片並移除工作階段內的處理結果。");
  }

  const activeResultUrl = activeItem && activeIsCurrent ? resultUrls.get(activeItem.id) : undefined;
  const beforeUrl = activeItem?.previewUrl;
  const activeSettings = activeItem ? effectiveSettings(settings, activeItem.overrides) : settings;
  const batchHasPng = items.some((item) => item.mime === "image/png" && (item.overrides.format ?? settings.format) === "same");

  return (
    <main className="main-shell workspace-shell">
      <div className="workspace-back"><Link href="/#tools" className="back-link"><ArrowLeftRight size={15} />所有圖片工具</Link><span><ShieldCheck size={14} />只在瀏覽器處理</span></div>
      <section className="workspace-intro"><div className="tool-title-icon"><FileImage size={23} /></div><div><h1>{localized(activeTool.name)}</h1><p>{localized(activeTool.description)}加入圖片後即可{localized(activeTool.verb)}。</p></div><span className="workspace-limit"><ShieldCheck size={13} />免登入・不需上傳</span></section>
      <nav className="workspace-tool-nav" aria-label="切換圖片工具">{getImageTools().map((candidate) => <Link key={candidate.slug} href={candidate.href} aria-current={activeTool.slug === candidate.slug ? "page" : undefined} onClick={(event) => { event.preventDefault(); switchTool(candidate); }}>{localized(candidate.shortName)}</Link>)}</nav>

      <section className={`upload-zone ${isDragging ? "upload-zone-active" : ""}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }} onDrop={handleDrop} aria-label="圖片上傳區">
        <div className="upload-icon"><ImagePlus size={22} /></div>
        <div className="upload-copy"><h2>{items.length ? "再加入幾張圖片" : "選擇圖片，或拖放到這裡"}</h2><p>支援靜態 JPG、PNG、WebP。每張不超過 20 MB、2,400 萬像素。</p></div>
        <div className="upload-actions"><label className="primary-button upload-button"><Upload size={16} />選擇圖片<input ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only" onChange={handleInput} /></label><span>最多 {MAX_FILES} 張</span></div>
      </section>

      {(notice || rejected.length > 0) && <div className="workspace-messages" role="status" aria-live="polite">{notice && <p className="notice-message"><ShieldCheck size={15} />{notice}</p>}{rejected.length > 0 && <div className="error-list" role="alert"><div className="error-list-title"><CircleAlert size={15} />有些檔案沒有加入</div><ul>{rejected.map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}</ul></div>}</div>}

      {items.length > 0 ? <div className="workspace-grid">
        <section className="file-panel" aria-labelledby="file-list-title">
          <div className="panel-heading"><div><h2 id="file-list-title">圖片清單 <span className="count-pill">{items.length}</span></h2><p>{doneCount ? `${doneCount} 張已完成` : "選擇圖片查看預覽"}</p></div><button className="icon-button" type="button" onClick={clearImages} aria-label="清空全部圖片" title="清空全部圖片" disabled={isProcessing}><Trash2 size={16} /></button></div>
          <ul className="image-list">{items.map((item) => {
            const current = isResultCurrent(item, settings);
            const overridesCount = Object.keys(item.overrides).length;
            return <li className={`image-list-item ${item.id === activeItem?.id ? "image-list-selected" : ""}`} key={item.id}>
              <button className="image-list-select" type="button" onClick={() => { setActiveId(item.id); setCompareOutput(true); }} aria-pressed={item.id === activeItem?.id}>
                <span className="thumbnail"><Image src={item.previewUrl} alt="" width={48} height={48} unoptimized /></span>
                <span className="image-list-copy"><strong title={item.file.name}>{item.file.name}</strong><span>{formatBytes(item.file.size)}<span className="list-middle-dot">·</span>{item.width} × {item.height}</span>
                  {overridesCount > 0 && <em>自訂 {overridesCount} 個設定</em>}
                </span>
                <span className={`status-pill status-${item.status}`}><i />{item.status === "processing" ? "處理中" : item.status === "queued" ? "等待中" : item.status === "done" ? (current ? "已完成" : "需重新處理") : item.status === "error" ? "處理失敗" : "待處理"}</span>
              </button>
              {item.status === "error" && <p className="item-error">{item.error}</p>}
              <div className="image-list-actions"><button type="button" className="small-text-button" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>{expandedId === item.id ? "收合設定" : overridesCount ? "調整這張" : "自訂這張"}</button>{current && <button type="button" className="small-text-button" onClick={() => downloadItem(item)}>下載</button>}<button className="row-remove" type="button" onClick={() => removeImage(item.id)} aria-label={`移除 ${item.file.name}`} disabled={isProcessing}><X size={14} /></button></div>
              {expandedId === item.id && <div className="override-panel"><div className="override-heading"><div><strong>這張圖片的設定</strong><span>{overridesCount ? `已自訂 ${overridesCount} 項` : "目前跟隨整批設定"}</span></div>{overridesCount > 0 && <button type="button" className="small-text-button" onClick={() => updateOverridesReset(item.id)}><RotateCcw size={12} />全部還原</button>}</div><SettingsFields value={effectiveSettings(settings, item.overrides)} base={settings} onChange={(key, value) => updateOverride(item.id, key, value)} webpAvailable={isWebpExportAvailable} compact /></div>}
            </li>;
          })}</ul>
          {items.length > 1 && <button className="zip-button" type="button" onClick={() => void downloadZip()} disabled={!doneCount || isZipping}><Archive size={15} />{isZipping ? "正在準備 ZIP…" : doneCount ? `下載已完成的圖片（${doneCount}）` : "完成處理後即可打包下載"}</button>}
          <p className="file-limit-note">單批上限 {MAX_FILES} 張・每張 {formatBytes(MAX_FILE_BYTES)}</p>
        </section>

        <section className="preview-panel" aria-labelledby="preview-title">
          <div className="panel-heading preview-panel-heading"><div><h2 id="preview-title">圖片預覽</h2><p>{activeItem ? `${activeItem.width} × ${activeItem.height} px` : "選擇一張圖片"}</p></div>{activeItem && <div className="compare-toggle" role="group" aria-label="選擇預覽版本"><button type="button" onClick={() => setCompareOutput(false)} aria-pressed={!compareOutput}>原始</button><button type="button" onClick={() => setCompareOutput(true)} aria-pressed={compareOutput}>結果</button></div>}</div>
          <div className="preview-canvas" aria-live="polite">{activeItem && (compareOutput && activeIsCurrent && activeResultUrl ? <Image className="preview-image" src={activeResultUrl} alt={`${activeItem.file.name} 的處理結果`} width={activeItem.result!.width} height={activeItem.result!.height} unoptimized /> : beforeUrl ? <Image className="preview-image" src={beforeUrl} alt={`${activeItem.file.name} 的原始圖片`} width={activeItem.width} height={activeItem.height} unoptimized /> : null)}{!activeItem && <div className="preview-empty"><FileImage size={29} /><span>圖片預覽會顯示在這裡</span></div>}{activeItem && compareOutput && !activeIsCurrent && <span className="preview-outdated">設定已變更，重新處理後才能比較</span>}</div>
          {activeItem && <div className="result-comparison"><div><span>原始檔案</span><strong>{formatBytes(activeItem.file.size)}</strong></div><ArrowLeftRight className="result-arrow" size={15} /><div><span>整理後</span><strong>{activeIsCurrent ? formatBytes(activeItem.result!.size) : "尚未處理"}</strong></div>{activeIsCurrent && <span className={`saved-chip ${activeItem.result!.size < activeItem.file.size ? "saved-smaller" : "saved-larger"}`}>{activeItem.result!.size < activeItem.file.size ? `少了 ${formatBytes(activeItem.file.size - activeItem.result!.size)}` : activeItem.result!.size > activeItem.file.size ? `多了 ${formatBytes(activeItem.result!.size - activeItem.file.size)}` : "大小相同"}</span>}</div>}
          {activeItem?.error && <p className="active-error" role="alert"><CircleAlert size={14} />{activeItem.error}</p>}
          {activeItem && activeIsCurrent && <button className="download-single" type="button" onClick={() => downloadItem(activeItem)}><ArrowDown size={16} />下載這張圖片</button>}
        </section>

        <section className="settings-panel" aria-labelledby="settings-title">
          <div className="panel-heading settings-heading"><div><h2 id="settings-title">整批設定</h2><p>已自訂的項目會保留自己的設定。</p></div></div>
          <SettingsFields value={settings} base={settings} onChange={updateBatchSetting} webpAvailable={isWebpExportAvailable} />
          {batchHasPng && settings.format === "same" && <p className="field-hint png-hint"><CircleAlert size={13} />PNG 不使用畫質壓縮。調整尺寸，或改轉 WebP，能減少檔案大小。</p>}
          {isFormatDisabled && <p className="field-hint"><CircleAlert size={13} />目前瀏覽器無法輸出 WebP，請改選 JPG 或 PNG。</p>}
          {settings.format === "image/jpeg" && items.some((item) => item.mime === "image/png") && <p className="field-hint png-hint"><CircleAlert size={13} />轉成 JPG 時，透明區域會填上白色。</p>}
          <div className="quality-setting"><label htmlFor="batch-quality"><span>輸出畫質 <span className="quality-applies">僅 JPG、WebP</span></span><output htmlFor="batch-quality">{Math.round(settings.quality * 100)}%</output></label><input id="batch-quality" type="range" min="30" max="100" step="5" value={Math.round(settings.quality * 100)} onChange={(event) => updateBatchSetting("quality", Number(event.target.value) / 100)} disabled={settings.format === "image/png"} /><div className="range-labels"><span>檔案較小</span><span>畫質較清晰</span></div></div>
          <div className="dimension-setting"><fieldset><legend>最大尺寸 <span>選填・保持比例</span></legend><div className="dimension-inputs"><label><span className="sr-only">最大寬度像素</span><input type="number" min="1" max="24000" inputMode="numeric" placeholder="寬度" value={settings.maxWidth ?? ""} onChange={(event) => updateDimension("maxWidth", event.target.value, updateBatchSetting)} /></label><span aria-hidden="true">×</span><label><span className="sr-only">最大高度像素</span><input type="number" min="1" max="24000" inputMode="numeric" placeholder="高度" value={settings.maxHeight ?? ""} onChange={(event) => updateDimension("maxHeight", event.target.value, updateBatchSetting)} /></label></div><p className="field-hint">留白則沿用圖片原尺寸，不會放大。</p></fieldset></div>
          <div className="settings-note"><ShieldCheck size={14} /><span>處理完成前，原始圖片不會被改動。</span></div>
          <div className="process-actions"><button className="primary-button process-button" type="button" onClick={() => void processBatch()} disabled={!readyCount || isFormatDisabled || isProcessing}>{isProcessing ? <><LoaderCircle className="spin-icon" size={16} />逐張處理中</> : doneCount && !readyCount ? <><Check size={16} />全部已整理</> : <><RefreshCw size={16} />{doneCount ? "重新處理待更新項目" : `開始${activeTool.shortName}`}</>}</button>{isProcessing ? <button className="small-text-button stop-button" type="button" onClick={() => { stopRef.current = true; setNotice("目前這張完成後，就會停止後續處理。"); }}>停止後續處理</button> : <span className="process-caption">依序在瀏覽器處理，安全又放心</span>}</div>
        </section>
      </div> : <section className="workspace-empty"><div className="workspace-empty-icon"><ImagePlus size={22} /></div><h2>準備好要整理的圖片了嗎？</h2><p>加入圖片後，你可以查看預覽、調整設定，並確認每張圖片的處理結果。</p><button type="button" className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={16} />選擇圖片開始使用</button><span><ShieldCheck size={14} />圖片不會離開你的裝置</span></section>}

      {items.length > 0 && <div className="workspace-footer"><Link href="/#tools">換一種圖片工具</Link><span>支援 JPG、PNG 和 WebP 靜態圖片</span></div>}
    </main>
  );

  function updateOverridesReset(id: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, overrides: {} } : item));
  }
}

function updateDimension(key: "maxWidth" | "maxHeight", value: string, onChange: <K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) => void) {
  const number = value ? Number(value) : null;
  onChange(key, number && Number.isFinite(number) && number > 0 ? Math.min(24000, Math.round(number)) : null);
}

function SettingsFields({ value, base, onChange, webpAvailable, compact = false }: { value: ImageSettings; base: ImageSettings; onChange: <K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) => void; webpAvailable: boolean; compact?: boolean }) {
  const selectId = compact ? "image-format-override" : "image-format";
  const widthId = compact ? "image-width-override" : "image-width";
  const heightId = compact ? "image-height-override" : "image-height";
  const qualityId = compact ? "image-quality-override" : "image-quality";
  return <div className={`settings-fields ${compact ? "settings-fields-compact" : ""}`}>
    <div className="setting-block"><label className="setting-label" htmlFor={selectId}>輸出格式</label><select id={selectId} value={value.format} onChange={(event) => onChange("format", event.target.value as ImageSettings["format"])}><option value="same">保留原格式</option><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp" disabled={!webpAvailable}>WebP{!webpAvailable ? "（瀏覽器不支援輸出）" : ""}</option></select><p className="field-hint">選擇輸出檔案格式，不會只改副檔名。</p></div>
    <div className="quality-setting"><label htmlFor={qualityId}><span>輸出畫質 <span className="quality-applies">僅 JPG、WebP</span></span><output htmlFor={qualityId}>{Math.round(value.quality * 100)}%</output></label><input id={qualityId} type="range" min="30" max="100" step="5" value={Math.round(value.quality * 100)} onChange={(event) => onChange("quality", Number(event.target.value) / 100)} disabled={value.format === "image/png"} /><div className="range-labels"><span>檔案較小</span><span>畫質較清晰</span></div></div>
    <fieldset className="dimension-fieldset"><legend>最大尺寸 <span>選填・保持比例</span></legend><div className="dimension-inputs"><label htmlFor={widthId}><span className="sr-only">最大寬度像素</span><input id={widthId} type="number" min="1" max="24000" inputMode="numeric" placeholder="寬度" value={value.maxWidth ?? ""} onChange={(event) => updateDimension("maxWidth", event.target.value, onChange)} /></label><span aria-hidden="true">×</span><label htmlFor={heightId}><span className="sr-only">最大高度像素</span><input id={heightId} type="number" min="1" max="24000" inputMode="numeric" placeholder="高度" value={value.maxHeight ?? ""} onChange={(event) => updateDimension("maxHeight", event.target.value, onChange)} /></label></div><p className="field-hint">留白則沿用圖片原尺寸，不會放大。</p></fieldset>
  </div>;
}
