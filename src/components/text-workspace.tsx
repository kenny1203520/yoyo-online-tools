"use client";
import { useI18n } from "@/lib/use-i18n";
import { message, type MessageRef } from "@/lib/messages";
import { useRouter } from "next/navigation";

import Link from "next/link";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { AlignLeft, ArrowDownToLine, Check, Clipboard, FileText, ListFilter, RotateCcw, ShieldCheck, Upload, WholeWord } from "lucide-react";
import { getTextTools, localized, type TextTool } from "@/lib/tools";
import { decodeUtf8TextFile, DEFAULT_TEXT_OPTIONS, getTextStats, MAX_TEXT_BYTES, safeTextFileStem, transformText, type TextCleanupOptions, type TextStats } from "@/lib/text-processing";

type ProcessedText = {
  source: string;
  output: string;
  sourceStats: TextStats;
  outputStats: TextStats;
  removedDuplicateLines: number;
};

function initialOptions(tool: TextTool): TextCleanupOptions {
  if (tool.textMode === "duplicates") return { ...DEFAULT_TEXT_OPTIONS, cleanWhitespace: false, removeDuplicateLines: true };
  if (tool.textMode === "count") return { ...DEFAULT_TEXT_OPTIONS, cleanWhitespace: false };
  return { ...DEFAULT_TEXT_OPTIONS };
}

function Metric({ label, value }: { label: string; value: number }) {
  const { locale } = useI18n();
  return <div className="text-metric"><span>{label}</span><strong>{value.toLocaleString(locale)}</strong></div>;
}

function StatsColumn({ title, stats, icon }: { title: string; stats?: TextStats; icon: "input" | "output" }) {
  const { t } = useI18n();
  const Icon = icon === "input" ? AlignLeft : WholeWord;
  const metrics: [string, number][] = stats ? [
    [t("characters"), stats.characters], [t("chineseCharacters"), stats.chineseCharacters], [t("englishWords"), stats.englishWords],
    [t("lines"), stats.lines], [t("utf8Bytes"), stats.utf8Bytes], [t("withoutWhitespace"), stats.charactersWithoutWhitespace],
  ] : [];
  return <div className="text-stats-column"><h2><Icon size={15} />{title}</h2>{metrics.length ? <div className="text-metrics-grid">{metrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div> : <p className="text-stats-pending">{t("addTextToSeeStatistics")}</p>}</div>;
}

export function TextWorkspace({ tool }: { tool: TextTool }) {
  const { t, locale, href, renderMessage, ready } = useI18n();
  const router = useRouter();
  const activeTool = tool;
  const [source, setSource] = useState("");
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [options, setOptions] = useState(() => initialOptions(tool));
  const [revision, setRevision] = useState(0);
  const [processed, setProcessed] = useState<ProcessedText | null>(null);
  const [processedRevision, setProcessedRevision] = useState(-1);
  const [notice, setNotice] = useState<MessageRef | null>(message("pasteTextOrImportAUtf8"));
  const [previousSource, setPreviousSource] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const requestVersion = useRef(0);

  const isProcessing = processedRevision !== revision;
  const isCurrent = !isProcessing && processed !== null;
  const showCleanup = options.cleanWhitespace;
  const output = isCurrent ? processed.output : "";
  const activeName = localized(activeTool.name, locale);
  const preview = (() => {
    if (activeTool.textMode === "count") return t("measureYourTextWithoutChangingIts");
    if (activeTool.textMode === "duplicates") return t("keepTheFirstOccurrenceOfEach");
    return t("paragraphsAndIndentationAreKeptBy");
  })();



  useEffect(() => {
    const requestId = ++requestVersion.current;
    const timer = window.setTimeout(() => {
      try {
        const transformed = transformText(source, options);
        const nextResult: ProcessedText = {
          source,
          output: transformed.value,
          sourceStats: getTextStats(source),
          outputStats: getTextStats(transformed.value),
          removedDuplicateLines: transformed.removedDuplicateLines,
        };
        if (requestId !== requestVersion.current) return;
        setProcessed(nextResult);
        setProcessedRevision(revision);
      } catch {
        if (requestId !== requestVersion.current) return;
        setNotice(message("theTextPreviewCouldNotBe"));
        setProcessed(null);
        setProcessedRevision(revision);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [options, revision, source]);

  function updateSource(nextSource: string, fileName: string | null = sourceFileName) {
    if (new TextEncoder().encode(nextSource).byteLength > MAX_TEXT_BYTES) {
      setNotice(message("textExceedsThe1MibLimit"));
      return;
    }
    setSource(nextSource);
    setSourceFileName(fileName);
    setRevision((current) => current + 1);
    setNotice(message("contentUpdatedPreparingYourPreview"));
  }

  function handlePasteArea(event: ChangeEvent<HTMLTextAreaElement>) {
    updateSource(event.target.value);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLocaleLowerCase("en").endsWith(".txt")) {
      setNotice(message("onlyTxtPlainTextFilesAre"));
      return;
    }
    if (file.size > MAX_TEXT_BYTES) {
      setNotice(message("thisFileExceeds1MibChoose"));
      return;
    }
    if (source && !window.confirm(t("importingThisFileWillReplaceYour"))) return;
    try {
      const value = decodeUtf8TextFile(await file.arrayBuffer());
      if (new TextEncoder().encode(value).byteLength > MAX_TEXT_BYTES) {
        setNotice(message("theDecodedTextExceedsThe1"));
        return;
      }
      setPreviousSource(source);
      updateSource(value, file.name);
    } catch {
      setNotice(message("thisFileIsNotValidUtf8"));
    }
  }

  function updateOption<Key extends keyof TextCleanupOptions>(key: Key, value: TextCleanupOptions[Key]) {
    setOptions((current) => ({ ...current, [key]: value }));
    setRevision((current) => current + 1);
    setNotice(message("settingsUpdatedRefreshingYourPreview"));
  }

  function switchTool(nextTool: TextTool) {
    if (nextTool.slug === activeTool.slug) return;
    router.push(href(nextTool.href), { scroll: false });
    setNotice(message("switchedTool"));
  }

  function clearText() {
    if (!source) return;
    setPreviousSource(source);
    updateSource("", null);
    setNotice(message("textClearedYouCanUndoThis"));
  }

  function undoClear() {
    if (previousSource === null) return;
    updateSource(previousSource, null);
    setPreviousSource(null);
    setNotice(message("previousChangeUndone"));
  }

  async function copyOutput() {
    if (!isCurrent || isProcessing) return;
    try {
      await navigator.clipboard.writeText(output);
      setNotice(message("resultCopied"));
    } catch {
      outputRef.current?.focus();
      outputRef.current?.select();
      setNotice(message("clipboardAccessFailedTheResultIs"));
    }
  }

  function downloadOutput() {
    if (!isCurrent || isProcessing) return;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${sourceFileName ? safeTextFileStem(sourceFileName) : "yoyo-text"}-cleaned.txt`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(message("yourTxtFileIsReadyTo"));
  }

  const textTools = getTextTools();

  return (
    <main id="content" tabIndex={-1} className="main-shell workspace-shell text-workspace-shell">
      <Link className="workspace-back" href={href("/#tools")}><span aria-hidden="true">←</span>{t("backToAllTools")}</Link>
      <section className="workspace-intro text-workspace-intro">
        <div className="tool-title-icon"><FileText size={22} /></div>
        <div><h1>{activeName}</h1><p>{localized(activeTool.description, locale)}</p></div>
        <span className="workspace-limit"><ShieldCheck size={13} />{t("noSigninLocalProcessing")}</span>
      </section>

      <nav className="workspace-tool-nav" aria-label={t("textTools")}>
        {textTools.map((candidate) => <Link key={candidate.slug} href={href(candidate.href)} aria-current={activeTool.slug === candidate.slug ? "page" : undefined} onClick={(event) => { event.preventDefault(); switchTool(candidate); }}>{localized(candidate.shortName, locale)}</Link>)}
      </nav>

      <section className="text-workspace-card" aria-label={t("textWorkspace")}>
        <div className="text-workspace-toolbar">
          <div><span className="section-kicker">{t("textStaysInThisSession")}</span><p>{preview}</p></div>
          <div className="text-input-actions">
            <input ref={inputRef} className="sr-only" type="file" accept=".txt,text/plain" aria-label={t("importAUtf8TxtFile")} onChange={handleFile} />
            <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}><Upload size={16} />{t("importTxt")}</button>
            {source && <button className="quiet-button" type="button" onClick={clearText}>{t("clear")}</button>}
            {previousSource !== null && <button className="quiet-button" type="button" onClick={undoClear}><RotateCcw size={14} />{t("undo")}</button>}
          </div>
        </div>

        <fieldset className="text-cleanup-options" disabled={!ready}>
          <legend>{t("cleanupRules")}</legend>
          <label><input type="checkbox" checked={options.cleanWhitespace} onChange={(event) => updateOption("cleanWhitespace", event.target.checked)} />{t("removeTrailingSpacesAndExtraBlank")}</label>
          <label><input type="checkbox" checked={options.removeLeadingWhitespace} disabled={!showCleanup} onChange={(event) => updateOption("removeLeadingWhitespace", event.target.checked)} />{t("removeLeadingWhitespace")}</label>
          <label><input type="checkbox" checked={options.joinSingleLineBreaks} disabled={!showCleanup} onChange={(event) => updateOption("joinSingleLineBreaks", event.target.checked)} />{t("joinSingleLineBreaksKeepBlank")}</label>
          <label><input type="checkbox" checked={options.removeDuplicateLines} onChange={(event) => updateOption("removeDuplicateLines", event.target.checked)} />{t("removeIdenticalDuplicateLines")}</label>
          <label><input type="checkbox" checked={options.ignoreTrimmedWhitespace} disabled={!options.removeDuplicateLines} onChange={(event) => updateOption("ignoreTrimmedWhitespace", event.target.checked)} />{t("ignoreSurroundingWhitespaceWhenComparingLines")}</label>
          <label><input type="checkbox" checked={options.ignoreCase} disabled={!options.removeDuplicateLines} onChange={(event) => updateOption("ignoreCase", event.target.checked)} />{t("ignoreLetterCaseWhenComparingLines")}</label>
        </fieldset>

        <div className="text-editor-grid">
          <section className="text-editor-panel" aria-labelledby="text-input-title">
            <div className="text-editor-heading"><label id="text-input-title" htmlFor="text-source">{t("originalText")}</label>{sourceFileName && <span title={sourceFileName}>{sourceFileName}</span>}</div>
            <textarea id="text-source" disabled={!ready} className="text-editor-area" value={source} onChange={handlePasteArea} placeholder={t("pasteYourTextHere")} spellCheck lang={locale} maxLength={MAX_TEXT_BYTES} />
            <p className="text-editor-hint">{t("upTo1MibUtf8Txt")}</p>
          </section>
          <section className="text-editor-panel" aria-labelledby="text-result-title">
            <div className="text-editor-heading"><label id="text-result-title" htmlFor="text-result">{t("result")}</label><span>{isProcessing ? t("updating") : isCurrent ? t("updated") : t("waitingForUpdate")}</span></div>
            <textarea ref={outputRef} id="text-result" className="text-editor-area text-result-area" value={output} readOnly placeholder={source ? t("preparingPreview") : t("yourResultWillAppearHereAfter")} aria-live="polite" />
            <p className="text-editor-hint">{isCurrent ? t("duplicateCount", { count: processed.removedDuplicateLines }) : t("copyOrDownloadOnceTheResult")}</p>
          </section>
        </div>

        <section className="text-stats-panel" aria-label={t("originalAndResultStatistics")}>
          <StatsColumn title={t("originalStatistics")} stats={isCurrent ? processed.sourceStats : undefined} icon="input" />
          <StatsColumn title={t("result")} stats={isCurrent ? processed.outputStats : undefined} icon="output" />
        </section>
        {isCurrent && !processed.outputStats.preciseCharacterCount && <p className="text-count-note">{t("thisBrowserCannotCountFullUnicode")}</p>}

        <div className="text-workspace-actions">
          <p className="text-workspace-notice" role="status" aria-live="polite">{isProcessing ? t("updatingTheResultCopyAndDownload") : renderMessage(notice)}</p>
          <div><button className="secondary-button" type="button" onClick={() => void copyOutput()} disabled={!isCurrent || isProcessing}><Clipboard size={16} />{t("copyResult")}</button><button className="primary-button" type="button" onClick={downloadOutput} disabled={!isCurrent || isProcessing}><ArrowDownToLine size={16} />{t("downloadTxt")}</button></div>
        </div>
        <p className="text-privacy-note"><ShieldCheck size={14} />{t("textIsProcessedOnlyInThis")}</p>
      </section>

      <footer className="workspace-footer"><Link href={href("/#tools")}>{t("exploreOtherTools")}</Link><span>{t("yourOriginalAndResultStaySeparate")}</span></footer>
    </main>
  );
}
