"use client";

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { AlignLeft, ArrowDownToLine, Check, Clipboard, FileText, ListFilter, RotateCcw, ShieldCheck, Upload, WholeWord } from "lucide-react";
import { getTextTool, getTextTools, localized, type TextTool } from "@/lib/tools";
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
  return <div className="text-metric"><span>{label}</span><strong>{value.toLocaleString("zh-TW")}</strong></div>;
}

function StatsColumn({ title, stats, icon }: { title: string; stats?: TextStats; icon: "input" | "output" }) {
  const Icon = icon === "input" ? AlignLeft : WholeWord;
  const metrics: [string, number][] = stats ? [
    ["字元", stats.characters], ["中文字", stats.chineseCharacters], ["英文單字", stats.englishWords],
    ["行數", stats.lines], ["UTF-8 位元組", stats.utf8Bytes], ["不含空白", stats.charactersWithoutWhitespace],
  ] : [];
  return <div className="text-stats-column"><h2><Icon size={15} />{title}</h2>{metrics.length ? <div className="text-metrics-grid">{metrics.map(([label, value]) => <Metric key={label} label={label} value={value} />)}</div> : <p className="text-stats-pending">輸入內容後顯示統計</p>}</div>;
}

export function TextWorkspace({ tool }: { tool: TextTool }) {
  const [activeTool, setActiveTool] = useState(tool);
  const [source, setSource] = useState("");
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [options, setOptions] = useState(() => initialOptions(tool));
  const [revision, setRevision] = useState(0);
  const [processed, setProcessed] = useState<ProcessedText | null>(null);
  const [processedRevision, setProcessedRevision] = useState(-1);
  const [notice, setNotice] = useState("貼上文字，或匯入 UTF-8 TXT 檔案開始整理。");
  const [previousSource, setPreviousSource] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLTextAreaElement>(null);
  const requestVersion = useRef(0);

  const isProcessing = processedRevision !== revision;
  const isCurrent = !isProcessing && processed !== null;
  const showCleanup = options.cleanWhitespace;
  const output = isCurrent ? processed.output : "";
  const activeName = localized(activeTool.name);
  const preview = useMemo(() => {
    if (activeTool.textMode === "count") return "檢視文字長度，不會自動修改內容。";
    if (activeTool.textMode === "duplicates") return "保留每行第一次出現的順序；原文仍會保留。";
    return "預設保留段落與縮排；需要改變結構時再開啟其他規則。";
  }, [activeTool.textMode]);

  useEffect(() => {
    document.title = `${activeName}｜YOYO 工具站`;
  }, [activeName]);

  useEffect(() => {
    function syncToolFromUrl() {
      const nextTool = getTextTool(window.location.pathname.split("/").pop() ?? "");
      if (nextTool) setActiveTool(nextTool);
    }
    window.addEventListener("popstate", syncToolFromUrl);
    return () => window.removeEventListener("popstate", syncToolFromUrl);
  }, []);

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
        setNotice("目前無法更新文字結果，請調整內容後重試。");
        setProcessed(null);
        setProcessedRevision(revision);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [options, revision, source]);

  function updateSource(nextSource: string, fileName: string | null = sourceFileName) {
    if (new TextEncoder().encode(nextSource).byteLength > MAX_TEXT_BYTES) {
      setNotice("文字超過 1 MiB 上限，請縮短內容後再貼上。");
      return;
    }
    setSource(nextSource);
    setSourceFileName(fileName);
    setRevision((current) => current + 1);
    setNotice("內容已更新，正在準備預覽。");
  }

  function handlePasteArea(event: ChangeEvent<HTMLTextAreaElement>) {
    updateSource(event.target.value);
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.name.toLocaleLowerCase("en").endsWith(".txt")) {
      setNotice("目前只接受 .txt 純文字檔案。");
      return;
    }
    if (file.size > MAX_TEXT_BYTES) {
      setNotice("檔案超過 1 MiB 上限，請選擇較小的 TXT 檔案。");
      return;
    }
    if (source && !window.confirm("匯入檔案會取代目前文字，要繼續嗎？")) return;
    try {
      const value = decodeUtf8TextFile(await file.arrayBuffer());
      if (new TextEncoder().encode(value).byteLength > MAX_TEXT_BYTES) {
        setNotice("解碼後的文字超過 1 MiB 上限。");
        return;
      }
      setPreviousSource(source);
      updateSource(value, file.name);
    } catch {
      setNotice("無法以 UTF-8 解讀這個檔案。請將檔案另存為 UTF-8 純文字後重試。");
    }
  }

  function updateOption<Key extends keyof TextCleanupOptions>(key: Key, value: TextCleanupOptions[Key]) {
    setOptions((current) => ({ ...current, [key]: value }));
    setRevision((current) => current + 1);
    setNotice("設定已更新，正在重新整理預覽。");
  }

  function switchTool(nextTool: TextTool) {
    if (nextTool.slug === activeTool.slug) return;
    window.history.pushState(null, "", nextTool.href);
    setActiveTool(nextTool);
    setNotice(`已切換到「${localized(nextTool.name)}」，文字和設定已保留。`);
  }

  function clearText() {
    if (!source) return;
    setPreviousSource(source);
    updateSource("", null);
    setNotice("文字已清空。你可以復原剛才的內容。");
  }

  function undoClear() {
    if (previousSource === null) return;
    updateSource(previousSource, null);
    setPreviousSource(null);
    setNotice("已復原上一步。");
  }

  async function copyOutput() {
    if (!isCurrent || isProcessing) return;
    try {
      await navigator.clipboard.writeText(output);
      setNotice("整理後的文字已複製。");
    } catch {
      outputRef.current?.focus();
      outputRef.current?.select();
      setNotice("無法直接存取剪貼簿。結果已選取，請使用鍵盤複製。");
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
    setNotice("TXT 檔案已準備下載。");
  }

  const textTools = getTextTools();

  return (
    <main className="main-shell workspace-shell text-workspace-shell">
      <Link className="workspace-back" href="/#tools"><span aria-hidden="true">←</span>回到全部工具</Link>
      <section className="workspace-intro text-workspace-intro">
        <div className="tool-title-icon"><FileText size={22} /></div>
        <div><h1>{activeName}</h1><p>{localized(activeTool.description)}</p></div>
        <span className="workspace-limit"><ShieldCheck size={13} />免登入・本機處理</span>
      </section>

      <nav className="workspace-tool-nav" aria-label="切換文字工具">
        {textTools.map((candidate) => <Link key={candidate.slug} href={candidate.href} aria-current={activeTool.slug === candidate.slug ? "page" : undefined} onClick={(event) => { event.preventDefault(); switchTool(candidate); }}>{localized(candidate.shortName)}</Link>)}
      </nav>

      <section className="text-workspace-card" aria-label="文字處理工作區">
        <div className="text-workspace-toolbar">
          <div><span className="section-kicker">文字留在目前工作階段</span><p>{preview}</p></div>
          <div className="text-input-actions">
            <input ref={inputRef} className="sr-only" type="file" accept=".txt,text/plain" aria-label="匯入 UTF-8 TXT 文字檔" onChange={handleFile} />
            <button className="secondary-button" type="button" onClick={() => inputRef.current?.click()}><Upload size={16} />匯入 TXT</button>
            {source && <button className="quiet-button" type="button" onClick={clearText}>清空</button>}
            {previousSource !== null && <button className="quiet-button" type="button" onClick={undoClear}><RotateCcw size={14} />復原</button>}
          </div>
        </div>

        <fieldset className="text-cleanup-options">
          <legend>整理規則</legend>
          <label><input type="checkbox" checked={options.cleanWhitespace} onChange={(event) => updateOption("cleanWhitespace", event.target.checked)} />清理行尾空格與多餘空白行</label>
          <label><input type="checkbox" checked={options.removeLeadingWhitespace} disabled={!showCleanup} onChange={(event) => updateOption("removeLeadingWhitespace", event.target.checked)} />移除每行開頭空白</label>
          <label><input type="checkbox" checked={options.joinSingleLineBreaks} disabled={!showCleanup} onChange={(event) => updateOption("joinSingleLineBreaks", event.target.checked)} />合併單一換行（保留空白行）</label>
          <label><input type="checkbox" checked={options.removeDuplicateLines} onChange={(event) => updateOption("removeDuplicateLines", event.target.checked)} />移除完全相同的重複行</label>
          <label><input type="checkbox" checked={options.ignoreTrimmedWhitespace} disabled={!options.removeDuplicateLines} onChange={(event) => updateOption("ignoreTrimmedWhitespace", event.target.checked)} />比對重複時忽略行首尾空白</label>
          <label><input type="checkbox" checked={options.ignoreCase} disabled={!options.removeDuplicateLines} onChange={(event) => updateOption("ignoreCase", event.target.checked)} />比對重複時忽略大小寫</label>
        </fieldset>

        <div className="text-editor-grid">
          <section className="text-editor-panel" aria-labelledby="text-input-title">
            <div className="text-editor-heading"><label id="text-input-title" htmlFor="text-source">原始文字</label>{sourceFileName && <span title={sourceFileName}>{sourceFileName}</span>}</div>
            <textarea id="text-source" className="text-editor-area" value={source} onChange={handlePasteArea} placeholder="在這裡貼上文字……" spellCheck lang="zh-Hant" maxLength={MAX_TEXT_BYTES} />
            <p className="text-editor-hint">最多 1 MiB · 支援 UTF-8 TXT</p>
          </section>
          <section className="text-editor-panel" aria-labelledby="text-result-title">
            <div className="text-editor-heading"><label id="text-result-title" htmlFor="text-result">整理結果</label><span>{isProcessing ? "正在更新…" : isCurrent ? "已更新" : "等待更新"}</span></div>
            <textarea ref={outputRef} id="text-result" className="text-editor-area text-result-area" value={output} readOnly placeholder={source ? "正在準備預覽……" : "加入文字後，結果會顯示在這裡。"} aria-live="polite" />
            <p className="text-editor-hint">{isCurrent ? `移除重複行 ${processed.removedDuplicateLines} 行` : "結果更新後即可複製或下載"}</p>
          </section>
        </div>

        <section className="text-stats-panel" aria-label="原文與結果統計">
          <StatsColumn title="原文統計" stats={isCurrent ? processed.sourceStats : undefined} icon="input" />
          <StatsColumn title="整理結果" stats={isCurrent ? processed.outputStats : undefined} icon="output" />
        </section>
        {isCurrent && !processed.outputStats.preciseCharacterCount && <p className="text-count-note">這個瀏覽器不支援完整的 Unicode 字元計數；字元統計以 Unicode 碼點估算。</p>}

        <div className="text-workspace-actions">
          <p className="text-workspace-notice" role="status" aria-live="polite">{isProcessing ? "正在更新結果，稍候即可複製或下載。" : notice}</p>
          <div><button className="secondary-button" type="button" onClick={() => void copyOutput()} disabled={!isCurrent || isProcessing}><Clipboard size={16} />複製結果</button><button className="primary-button" type="button" onClick={downloadOutput} disabled={!isCurrent || isProcessing}><ArrowDownToLine size={16} />下載 TXT</button></div>
        </div>
        <p className="text-privacy-note"><ShieldCheck size={14} />文字只在目前瀏覽器工作階段處理，不會上傳或保存。</p>
      </section>

      <footer className="workspace-footer"><Link href="/#tools">查看其他工具</Link><span>原文與結果在此分開，修改後會重新整理預覽。</span></footer>
    </main>
  );
}
