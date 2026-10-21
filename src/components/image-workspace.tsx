"use client";
import { useI18n } from "@/lib/use-i18n";
import { message, type MessageRef } from "@/lib/messages";
import { useRouter } from "next/navigation";

import { processingIssue } from "@/lib/processing-error";
import Image from "next/image";
import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Archive, ArrowDown, ArrowLeftRight, Check, CircleAlert, FileImage, ImagePlus, LoaderCircle, RefreshCw, RotateCcw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { getImageTools, localized, type ImageTool } from "@/lib/tools";
import { effectiveSettings, fileExtension, formatBytes as bytes, ImageEntry, ImageSettings, inspectImage, MAX_FILES, MAX_FILE_BYTES, processImage, safeFileName, settingsKey, supportsOutputFormat } from "@/lib/image-processing";

const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

function initialSettings(tool: ImageTool): ImageSettings {
  return { format: tool.format === "image-convert" ? "image/webp" : "same", quality: 0.82, maxWidth: null, maxHeight: null };
}

function isResultCurrent(entry: ImageEntry, base: ImageSettings) {
  return Boolean(entry.result && entry.result.settingsKey === settingsKey(effectiveSettings(base, entry.overrides), entry.mime));
}

export function ImageWorkspace({ tool }: { tool: ImageTool }) {
  const { t, locale, href, renderMessage, ready } = useI18n();
  const router = useRouter();
  const formatBytes = (value: number) => bytes(value, locale);
  const activeTool = tool;
  const [items, setItems] = useState<ImageEntry[]>([]);
  const [settings, setSettings] = useState(() => initialSettings(tool));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resultUrls, setResultUrls] = useState<Map<string, string>>(() => new Map());
  const [rejected, setRejected] = useState<{ name?: string; issue: MessageRef }[]>([]);
  const [notice, setNotice] = useState<MessageRef | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isZipping, setIsZipping] = useState(false);
  const [compareOutput, setCompareOutput] = useState(true);
  const [isWebpExportAvailable, setIsWebpExportAvailable] = useState(true);
  const initialTool = useRef(tool);
  const inputRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef(false);
  const mountedRef = useRef(false);
  const urlsRef = useRef(new Set<string>());


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
      if (!supported && initialTool.current.format === "image-convert") {
        setSettings((previous) => ({ ...previous, format: "same" }));
        setNotice(message("webpExportIsUnavailableInThis"));
      }
    });
    return () => { current = false; };
  }, []);

  const activeItem = items.find((item) => item.id === activeId) ?? items[0] ?? null;
  const activeIsCurrent = activeItem ? isResultCurrent(activeItem, settings) : false;
  const readyCount = items.filter((item) => item.status === "ready" || item.status === "error" || (item.status === "done" && !isResultCurrent(item, settings))).length;
  const doneCount = items.filter((item) => isResultCurrent(item, settings)).length;
  const isFormatDisabled = settings.format === "image/webp" && !isWebpExportAvailable;

  const addFiles = useCallback(async (selected: FileList | File[]) => {
    const incoming = Array.from(selected);
    if (incoming.length === 0) return;
    setRejected([]);
    setNotice(null);
    const slots = Math.max(0, MAX_FILES - items.length);
    const candidates = incoming.slice(0, slots);
    const nextRejected: { name?: string; issue: MessageRef }[] = incoming.length > slots ? [{ issue: message("batchLimit", { count: MAX_FILES }) }] : [];
    const accepted: ImageEntry[] = [];
    for (const file of candidates) {
      try {
        const dimensions = await inspectImage(file);
        if (!mountedRef.current) return;
        const previewUrl = URL.createObjectURL(file);
        urlsRef.current.add(previewUrl);
        accepted.push({ id: crypto.randomUUID(), file, previewUrl, mime: dimensions.mime, width: dimensions.width, height: dimensions.height, overrides: {}, status: "ready" });
      } catch (error) {
        nextRejected.push({ name: file.name, issue: processingIssue(error) });
      }
    }
    if (!mountedRef.current) return;
    if (accepted.length) {
      setItems((current) => [...current, ...accepted].slice(0, MAX_FILES));
      setActiveId((current) => current ?? accepted[0]?.id ?? null);
      setNotice(message("addedImages", { count: accepted.length }));
    }
    setRejected(nextRejected);
    if (!accepted.length && !nextRejected.length) setNotice(message("noNewImagesAdded"));
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
    router.push(href(nextTool.href), { scroll: false });
    if (nextTool.format === "image-convert") {
      setSettings((current) => ({ ...current, format: isWebpExportAvailable ? "image/webp" : "same" }));
    }
    setNotice(message("switchedTool"));
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
    setNotice(message("imageRemoved"));
  }

  async function processBatch() {
    if (isProcessing || !readyCount) return;
    stopRef.current = false;
    setIsProcessing(true);
    setRejected([]);
    setNotice(message("processingImagesOneAtATime"));
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
        const issue = processingIssue(error);
        setItems((current) => current.map((candidate) => candidate.id === item.id ? { ...candidate, status: "error", error: issue } : candidate));
      }
    }
    if (!mountedRef.current) return;
    setItems((current) => current.map((item) => item.status === "queued" ? { ...item, status: "ready" } : item));
    setIsProcessing(false);
    setNotice(stopRef.current ? message("remainingProcessingStoppedCompletedImagesAre") : message("processingFinishedReviewTheResultsBefore"));
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
    setNotice(message("preparingYourZipFile"));
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
      setNotice(message("zipReady", { count: completed.length }));
    } catch {
      setNotice(message("zipCreationFailedYouCanStill"));
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
    setNotice(message("allImagesAndProcessingResultsCleared"));
  }

  const activeResultUrl = activeItem && activeIsCurrent ? resultUrls.get(activeItem.id) : undefined;
  const beforeUrl = activeItem?.previewUrl;
  const activeSettings = activeItem ? effectiveSettings(settings, activeItem.overrides) : settings;
  const batchHasPng = items.some((item) => item.mime === "image/png" && (item.overrides.format ?? settings.format) === "same");

  return (
    <main id="content" tabIndex={-1} className="main-shell workspace-shell">
      <div className="workspace-back"><Link href={href("/#tools")} className="back-link"><ArrowLeftRight size={15} />{t("allImageTools")}</Link><span><ShieldCheck size={14} />{t("processedInYourBrowser")}</span></div>
      <section className="workspace-intro"><div className="tool-title-icon"><FileImage size={23} /></div><div><h1>{localized(activeTool.name, locale)}</h1><p>{localized(activeTool.description, locale)}</p></div><span className="workspace-limit"><ShieldCheck size={13} />{t("noSigninNoUpload")}</span></section>
      <nav className="workspace-tool-nav" aria-label={t("imageTools")}>{getImageTools().map((candidate) => <Link key={candidate.slug} href={href(candidate.href)} aria-current={activeTool.slug === candidate.slug ? "page" : undefined} onClick={(event) => { event.preventDefault(); switchTool(candidate); }}>{localized(candidate.shortName, locale)}</Link>)}</nav>

      <section className={`upload-zone ${isDragging ? "upload-zone-active" : ""}`} onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }} onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDragging(false); }} onDrop={handleDrop} aria-label={t("addImages")}>
        <div className="upload-icon"><ImagePlus size={22} /></div>
        <div className="upload-copy"><h2>{items.length ? t("addMoreImages") : t("chooseImagesOrDropThemHere")}</h2><p>{t("staticJpgPngAndWebpUp")}</p></div>
        <div className="upload-actions"><label className="primary-button upload-button"><Upload size={16} />{t("chooseImages")}<input ref={inputRef} type="file" disabled={!ready} accept={ACCEPT} multiple className="sr-only" onChange={handleInput} /></label><span>{t("maxImages", { count: MAX_FILES })}</span></div>
      </section>

      {(notice || rejected.length > 0) && <div className="workspace-messages" role="status" aria-live="polite">{notice && <p className="notice-message"><ShieldCheck size={15} />{renderMessage(notice)}</p>}{rejected.length > 0 && <div className="error-list" role="alert"><div className="error-list-title"><CircleAlert size={15} />{t("someFilesCouldNotBeAdded")}</div><ul>{rejected.map((entry, index) => <li key={index}>{entry.name ? t("fileError", { name: entry.name, error: renderMessage(entry.issue) }) : renderMessage(entry.issue)}</li>)}</ul></div>}</div>}

      {items.length > 0 ? <div className="workspace-grid">
        <section className="file-panel" aria-labelledby="file-list-title">
          <div className="panel-heading"><div><h2 id="file-list-title">{t("imageList")}<span className="count-pill">{items.length}</span></h2><p>{doneCount ? t("completedImages", { count: doneCount }) : t("chooseAnImageToPreview")}</p></div><button className="icon-button" type="button" onClick={clearImages} aria-label={t("clearAllImages")} title={t("clearAllImages")} disabled={isProcessing}><Trash2 size={16} /></button></div>
          <ul className="image-list">{items.map((item) => {
            const current = isResultCurrent(item, settings);
            const overridesCount = Object.keys(item.overrides).length;
            return <li className={`image-list-item ${item.id === activeItem?.id ? "image-list-selected" : ""}`} key={item.id}>
              <button className="image-list-select" type="button" onClick={() => { setActiveId(item.id); setCompareOutput(true); }} aria-pressed={item.id === activeItem?.id}>
                <span className="thumbnail"><Image src={item.previewUrl} alt="" width={48} height={48} unoptimized /></span>
                <span className="image-list-copy"><strong title={item.file.name}>{item.file.name}</strong><span>{formatBytes(item.file.size)}<span className="list-middle-dot">·</span>{item.width} × {item.height}</span>
                  {overridesCount > 0 && <em>{t("customFields", { count: overridesCount })}</em>}
                </span>
                <span className={`status-pill status-${item.status}`}><i />{item.status === "processing" ? t("processing") : item.status === "queued" ? t("queued") : item.status === "done" ? (current ? t("done") : t("needsReprocessing")) : item.status === "error" ? t("failed") : t("ready")}</span>
              </button>
              {item.status === "error" && <p className="item-error">{renderMessage(item.error ?? null)}</p>}
              <div className="image-list-actions"><button type="button" className="small-text-button" onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}>{expandedId === item.id ? t("hideSettings") : overridesCount ? t("editSettings") : t("customize")}</button>{current && <button type="button" className="small-text-button" onClick={() => downloadItem(item)}>{t("download")}</button>}<button className="row-remove" type="button" onClick={() => removeImage(item.id)} aria-label={t("removeFile", { name: item.file.name })} disabled={isProcessing}><X size={14} /></button></div>
              {expandedId === item.id && <div className="override-panel"><div className="override-heading"><div><strong>{t("settingsForThisImage")}</strong><span>{overridesCount ? t("customFields", { count: overridesCount }) : t("followingBatchSettings")}</span></div>{overridesCount > 0 && <button type="button" className="small-text-button" onClick={() => updateOverridesReset(item.id)}><RotateCcw size={12} />{t("resetAllOverrides")}</button>}</div><SettingsFields value={effectiveSettings(settings, item.overrides)} base={settings} onChange={(key, value) => updateOverride(item.id, key, value)} webpAvailable={isWebpExportAvailable} qualityAvailable={(item.overrides.format ?? settings.format) === "same" ? item.mime !== "image/png" : (item.overrides.format ?? settings.format) !== "image/png"} compact /></div>}
            </li>;
          })}</ul>
          {items.length > 1 && <button className="zip-button" type="button" onClick={() => void downloadZip()} disabled={!doneCount || isZipping}><Archive size={15} />{isZipping ? t("preparingZip") : doneCount ? t("downloadCompleted", { count: doneCount }) : t("processImagesToDownloadAZip")}</button>}
          <p className="file-limit-note">{t("batchSummary", { count: MAX_FILES, size: formatBytes(MAX_FILE_BYTES) })}</p>
        </section>

        <section className="preview-panel" aria-labelledby="preview-title">
          <div className="panel-heading preview-panel-heading"><div><h2 id="preview-title">{t("imagePreview")}</h2><p>{activeItem ? `${activeItem.width} × ${activeItem.height} px` : t("chooseAnImage")}</p></div>{activeItem && <div className="compare-toggle" role="group" aria-label={t("previewVersion")}><button type="button" onClick={() => setCompareOutput(false)} aria-pressed={!compareOutput}>{t("original")}</button><button type="button" onClick={() => setCompareOutput(true)} aria-pressed={compareOutput}>{t("output")}</button></div>}</div>
          <div className="preview-canvas" aria-live="polite">{activeItem && (compareOutput && activeIsCurrent && activeResultUrl ? <Image className="preview-image" src={activeResultUrl} alt={t("outputAlt", { name: activeItem.file.name })} width={activeItem.result!.width} height={activeItem.result!.height} unoptimized /> : beforeUrl ? <Image className="preview-image" src={beforeUrl} alt={t("originalAlt", { name: activeItem.file.name })} width={activeItem.width} height={activeItem.height} unoptimized /> : null)}{!activeItem && <div className="preview-empty"><FileImage size={29} /><span>{t("yourImagePreviewWillAppearHere")}</span></div>}{activeItem?.result && compareOutput && !activeIsCurrent && <span className="preview-outdated">{t("settingsChangedReprocessToCompare")}</span>}</div>
          {activeItem && <div className="result-comparison"><div><span>{t("originalFile")}</span><strong>{formatBytes(activeItem.file.size)}</strong></div><ArrowLeftRight className="result-arrow" size={15} /><div><span>{t("processed")}</span><strong>{activeIsCurrent ? formatBytes(activeItem.result!.size) : t("notProcessedYet")}</strong></div>{activeIsCurrent && <span className={`saved-chip ${activeItem.result!.size < activeItem.file.size ? "saved-smaller" : "saved-larger"}`}>{activeItem.result!.size < activeItem.file.size ? t("smallerBy", { size: formatBytes(activeItem.file.size - activeItem.result!.size) }) : activeItem.result!.size > activeItem.file.size ? t("largerBy", { size: formatBytes(activeItem.result!.size - activeItem.file.size) }) : t("sameSize")}</span>}</div>}
          {activeItem?.error && <p className="active-error" role="alert"><CircleAlert size={14} />{renderMessage(activeItem.error)}</p>}
          {activeItem && activeIsCurrent && <button className="download-single" type="button" onClick={() => downloadItem(activeItem)}><ArrowDown size={16} />{t("downloadThisImage")}</button>}
        </section>

        <section className="settings-panel" aria-labelledby="settings-title">
          <div className="panel-heading settings-heading"><div><h2 id="settings-title">{t("batchSettings")}</h2><p>{t("customizedFieldsKeepTheirOwnSettings")}</p></div></div>
          <SettingsFields value={settings} base={settings} onChange={updateBatchSetting} webpAvailable={isWebpExportAvailable} qualityAvailable={items.some((item) => { const f = item.overrides.format ?? settings.format; return (f === "same" ? item.mime : f) !== "image/png"; })} />
          {batchHasPng && settings.format === "same" && <p className="field-hint png-hint"><CircleAlert size={13} />{t("pngHasNoQualitySettingResize")}</p>}
          {isFormatDisabled && <p className="field-hint"><CircleAlert size={13} />{t("thisBrowserCannotExportWebpChoose")}</p>}
          {settings.format === "image/jpeg" && items.some((item) => item.mime === "image/png") && <p className="field-hint png-hint"><CircleAlert size={13} />{t("transparentAreasWillBeFilledWhite")}</p>}
          <div className="settings-note"><ShieldCheck size={14} /><span>{t("yourOriginalImagesRemainUnchanged")}</span></div>
          <div className="process-actions"><button className="primary-button process-button" type="button" onClick={() => void processBatch()} disabled={!readyCount || isFormatDisabled || isProcessing}>{isProcessing ? <><LoaderCircle className="spin-icon" size={16} />{t("processingImages")}</> : doneCount && !readyCount ? <><Check size={16} />{t("allDone")}</> : <><RefreshCw size={16} />{doneCount ? t("reprocessOutdatedItems") : t("startProcessing")}</>}</button>{isProcessing ? <button className="small-text-button stop-button" type="button" onClick={() => { stopRef.current = true; setNotice(message("processingWillStopAfterTheCurrent")); }}>{t("stopRemaining")}</button> : <span className="process-caption">{t("processedOneAtATimeIn")}</span>}</div>
        </section>
      </div> : <section className="workspace-empty"><div className="workspace-empty-icon"><ImagePlus size={22} /></div><h2>{t("readyToWorkOnYourImages")}</h2><p>{t("addImagesToPreviewThemAdjust")}</p><button type="button" className="primary-button" onClick={() => inputRef.current?.click()}><Upload size={16} />{t("chooseImagesToStart")}</button><span><ShieldCheck size={14} />{t("imagesStayOnYourDevice")}</span></section>}

      {items.length > 0 && <div className="workspace-footer"><Link href={href("/#tools")}>{t("chooseAnotherImageTool")}</Link><span>{t("staticJpgPngAndWebpSupported")}</span></div>}
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

function SettingsFields({ value, base, onChange, webpAvailable, qualityAvailable = true, compact = false }: { value: ImageSettings; base: ImageSettings; onChange: <K extends keyof ImageSettings>(key: K, value: ImageSettings[K]) => void; webpAvailable: boolean; qualityAvailable?: boolean; compact?: boolean }) {
  const { t } = useI18n();
  const selectId = compact ? "image-format-override" : "image-format";
  const widthId = compact ? "image-width-override" : "image-width";
  const heightId = compact ? "image-height-override" : "image-height";
  const qualityId = compact ? "image-quality-override" : "image-quality";
  return <div className={`settings-fields ${compact ? "settings-fields-compact" : ""}`}>
    <div className="setting-block"><label className="setting-label" htmlFor={selectId}>{t("outputFormat")}</label><select id={selectId} value={value.format} onChange={(event) => onChange("format", event.target.value as ImageSettings["format"])}><option value="same">{t("keepOriginalFormat")}</option><option value="image/jpeg">JPG</option><option value="image/png">PNG</option><option value="image/webp" disabled={!webpAvailable}>WebP{!webpAvailable ? t("exportUnavailable") : ""}</option></select><p className="field-hint">{t("theImageIsConvertedToYour")}</p></div>
    <div className="quality-setting"><label htmlFor={qualityId}><span>{t("outputQuality")}<span className="quality-applies">{t("jpgAndWebpOnly")}</span></span><output htmlFor={qualityId}>{Math.round(value.quality * 100)}%</output></label><input id={qualityId} type="range" min="30" max="100" step="5" value={Math.round(value.quality * 100)} onChange={(event) => onChange("quality", Number(event.target.value) / 100)} disabled={value.format === "image/png" || !qualityAvailable} /><div className="range-labels"><span>{t("smallerFile")}</span><span>{t("higherQuality")}</span></div></div>
    <fieldset className="dimension-fieldset"><legend>{t("maximumDimensions")}<span>{t("optionalKeepProportions")}</span></legend><div className="dimension-inputs"><label htmlFor={widthId}><span className="sr-only">{t("maximumWidthInPixels")}</span><input id={widthId} type="number" min="1" max="24000" inputMode="numeric" placeholder={t("width")} value={value.maxWidth ?? ""} onChange={(event) => updateDimension("maxWidth", event.target.value, onChange)} /></label><span aria-hidden="true">×</span><label htmlFor={heightId}><span className="sr-only">{t("maximumHeightInPixels")}</span><input id={heightId} type="number" min="1" max="24000" inputMode="numeric" placeholder={t("height")} value={value.maxHeight ?? ""} onChange={(event) => updateDimension("maxHeight", event.target.value, onChange)} /></label></div><p className="field-hint">{t("leaveBlankToKeepOriginalDimensions")}</p></fieldset>
  </div>;
}
