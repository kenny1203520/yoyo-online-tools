"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { ArrowDownToLine, Check, Clipboard, FileUp, Play, RotateCcw, ShieldCheck } from "lucide-react";
import { useI18n } from "@/lib/use-i18n";
import { localized, getDeveloperTools, type DeveloperTool } from "@/lib/tools";
import { CodeEditor } from "./code-editor";
import { MAX_ENGINEER_INPUT_BYTES } from "@/lib/developer-processing";
import { executeDeveloperJob, type DeveloperJob, type DeveloperReply, type RegexMatch } from "@/lib/developer-job";
import type { MessageKey } from "@/lib/messages";
import { createDeveloperWorker } from "@/lib/tool-workers";

const examples: Record<DeveloperTool["developerMode"], string> = {
  json: '{"name":"YOYO","items":[1,2,3],"active":true}', diff: "name: YOYO\nstatus: ready", base64: "YOYO 工具站 🚀", url: "搜尋 空間模型 + 圖片", timestamp: "1761024000", regex: "Contact hello@example.com or team@example.tw",
};

export function DeveloperWorkspace({ tool }: { tool: DeveloperTool }) {
  const { t, locale, href, ready } = useI18n();
  const [source, setSource] = useState("");
  const [other, setOther] = useState("");
  const [result, setResult] = useState("");
  const [issue, setIssue] = useState<MessageKey | null>(null);
  const [diagnostic, setDiagnostic] = useState<{ position: number; side: "source" | "other" } | null>(null);
  const [hasResult, setHasResult] = useState(false);
  const [undo, setUndo] = useState<{ source: string; other: string; iso: string } | null>(null);
  const [ignoreTrailingWhitespace, setIgnoreTrailingWhitespace] = useState(false);
  const [editorSize, setEditorSize] = useState(14);
  const inputVersion = useRef(0);
  const requestSequence = useRef(0);
  const [diffMode, setDiffMode] = useState<"text" | "json">("text");
  const [indent, setIndent] = useState("2");
  const [base64Mode, setBase64Mode] = useState<"standard" | "url">("standard");
  const [urlMode, setUrlMode] = useState<"component" | "url">("component");
  const [direction, setDirection] = useState<"encode" | "decode">("encode");
  const [timestampUnit, setTimestampUnit] = useState<"seconds" | "milliseconds">("seconds");
  const [timestampDirection, setTimestampDirection] = useState<"toDate" | "toTimestamp">("toDate");
  const [iso, setIso] = useState("");
  const [regexPattern, setRegexPattern] = useState("[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}");
  const [regexFlags, setRegexFlags] = useState<string[]>(["g"]);
  const [replacement, setReplacement] = useState("[email]");
  const [regexMatches, setRegexMatches] = useState<RegexMatch[]>([]);
  const [regexBusy, setRegexBusy] = useState(false);
  const regexWorker = useRef<Worker | null>(null);
  const regexTimeout = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (regexTimeout.current !== null) window.clearTimeout(regexTimeout.current);
    regexWorker.current?.terminate();
  }, []);

  function stopWorker() {
    if (regexTimeout.current !== null) window.clearTimeout(regexTimeout.current);
    regexTimeout.current = null; regexWorker.current?.terminate(); regexWorker.current = null;
  }
  function resetResult() {
    inputVersion.current++; requestSequence.current++; stopWorker();
    setResult(""); setHasResult(false); setIssue(null); setDiagnostic(null); setRegexMatches([]); setRegexBusy(false);
  }

  function loadExample() {
    if ((source || other || iso) && !window.confirm(t("developerConfirmOverwrite"))) return;
    setSource(examples[tool.developerMode]);
    if (tool.developerMode === "timestamp") setIso("2026-10-21T12:00:00+08:00");
    if (tool.developerMode === "diff") setOther("name: YOYO\nstatus: complete\nversion: 2");
    if (tool.developerMode === "json") setOther('{"name":"YOYO","items":[1,2,3],"active":true}');
    resetResult();
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (source && !window.confirm(t("developerConfirmOverwrite"))) return;
    resetResult();
    const version = inputVersion.current;
    if (!/\.(txt|json)$/i.test(file.name)) { setIssue("developerOnlyTextJsonFiles"); return; }
    if (file.size > MAX_ENGINEER_INPUT_BYTES) { setIssue("developerInputTooLarge"); return; }
    try {
      const bytes = await file.arrayBuffer();
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
      if (version !== inputVersion.current) return;
      setSource(decoded); resetResult();
    } catch { if (version === inputVersion.current) setIssue("developerFileInvalidUtf8"); }
  }

  async function copy(value = result) {
    if (!hasResult) return;
    try { await navigator.clipboard.writeText(value); setIssue(null); }
    catch { setIssue("developerClipboardUnavailable"); }
  }

  function download(value = result) {
    if (!hasResult) return;
    const blob = new Blob([value], { type: tool.developerMode === "json" ? "application/json;charset=utf-8" : "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = tool.developerMode === "json" ? "yoyo-result.json" : "yoyo-result.txt";
    anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function run(minify = false) {
    resetResult();
    const requestId = ++requestSequence.current;
    const job: DeveloperJob = {
      requestId, version: inputVersion.current, mode: tool.developerMode, source, other,
      indent, minify, diffMode, ignoreTrailingWhitespace, base64Mode, urlMode, direction,
      timestampUnit, timestampDirection, iso, pattern: regexPattern, flags: regexFlags.join(""), replacement, locale,
      labels: { same: t("developerJsonSame"), different: t("developerJsonDifferent"), left: t("developerLeft"), right: t("developerRight"), utc: t("developerUtc"), taipei: t("developerTaipei"), local: t("developerLocalTime") },
    };
    const finish = (reply: DeveloperReply) => {
      if (reply.requestId !== requestSequence.current || reply.version !== inputVersion.current) return;
      stopWorker(); setRegexBusy(false);
      if (reply.status === "error") {
        setIssue(reply.code);
        if (reply.position !== undefined) setDiagnostic({ position: reply.position, side: reply.side ?? "source" });
      } else { setResult(reply.output); setHasResult(true); setRegexMatches(reply.groups); }
    };
    if (!["json", "diff", "regex"].includes(tool.developerMode)) { finish(executeDeveloperJob(job)); return; }
    if (typeof Worker === "undefined") { setIssue("developerWorkerUnavailable"); return; }
    try {
      const worker = createDeveloperWorker();
      regexWorker.current = worker; setRegexBusy(true);
      regexTimeout.current = window.setTimeout(() => {
        if (job.requestId !== requestSequence.current) return;
        stopWorker(); setRegexBusy(false); setIssue("developerWorkerUnavailable");
      }, 15000);
      worker.onmessage = (event: MessageEvent<DeveloperReply | { ready: true }>) => {
        if ("ready" in event.data) {
          if (job.requestId !== requestSequence.current) return;
          if (regexTimeout.current !== null) window.clearTimeout(regexTimeout.current);
          regexTimeout.current = window.setTimeout(() => { if (job.requestId === requestSequence.current) { stopWorker(); setRegexBusy(false); setIssue(tool.developerMode === "regex" ? "developerRegexTimeout" : "developerJobTimeout"); } }, tool.developerMode === "regex" ? 2000 : 5000);
          worker.postMessage(job);
        } else finish(event.data);
      };
      worker.onerror = () => { if (job.requestId === requestSequence.current) { stopWorker(); setRegexBusy(false); setIssue("developerOperationFailed"); } };
    } catch { stopWorker(); setRegexBusy(false); setIssue("developerWorkerUnavailable"); }
  }

  function selectAll() {
    if (!source && !other && !iso) return;
    setUndo({ source, other, iso }); setSource(""); setOther(""); setIso(""); resetResult();
  }
  function cancelRegex() { resetResult(); setIssue("developerRegexCancelled"); }
  const activeName = localized(tool.name, locale);

  return <main id="content" tabIndex={-1} className="main-shell developer-page" style={{ "--editor-size": `${editorSize / 16}rem` } as CSSProperties}>
    <div className="workspace-intro">
      <div><Link className="back-link" href={href("/")}>{t("backToAllTools")}</Link><h1>{activeName}</h1><p>{localized(tool.description, locale)}</p></div>
      <div className="developer-local"><ShieldCheck size={16} />{t("developerLocalPrivacy")}</div>
    </div>
    <nav className="workspace-tool-nav" aria-label={t("developerTools")}>
      {getDeveloperTools().map((item) => <Link key={item.slug} href={href(item.href)} aria-current={item.slug === tool.slug ? "page" : undefined}>{localized(item.shortName, locale)}</Link>)}
    </nav>
    <div className="developer-options"><label>{t("developerEditorSize")}<select value={editorSize} onChange={(event) => setEditorSize(Number(event.target.value))}>{[14,16,18,20].map((size) => <option key={size} value={size}>{size}px</option>)}</select></label><p>{t("developerResourceLimits")}</p></div>
    <section className="developer-workspace" aria-label={activeName}>
      <fieldset className="developer-panel" disabled={!ready} aria-label={t("developerInput")}>
        <div className="developer-toolbar">
          <strong>{tool.developerMode === "diff" ? t("developerLeft") : t("developerInput")}</strong>
          <div className="developer-toolbar-actions">
            <button type="button" className="button-secondary" onClick={loadExample}><RotateCcw size={16} />{t("developerLoadExample")}</button>
            <button type="button" className="button-secondary" onClick={() => inputRef.current?.click()}><FileUp size={16} />{t("developerImportText")}</button>
            <input ref={inputRef} className="sr-only" type="file" accept=".txt,.json,text/plain,application/json" onChange={importFile} />
          </div>
        </div>
        {tool.developerMode === "diff" && <div className="developer-options"><label>{t("developerCompareMode")}<select value={diffMode} onChange={(event) => { setDiffMode(event.target.value as "text" | "json"); resetResult(); }}><option value="text">{t("developerPlainText")}</option><option value="json">JSON</option></select></label></div>}
        {tool.developerMode === "diff" && diffMode === "text" && <label className="developer-checkbox"><input type="checkbox" checked={ignoreTrailingWhitespace} onChange={(event) => { resetResult(); setIgnoreTrailingWhitespace(event.target.checked); }} />{t("developerIgnoreTrailing")}</label>}
        {tool.developerMode === "json" && <div className="developer-options"><label>{t("developerIndentation")}<select value={indent} onChange={(event) => { resetResult(); setIndent(event.target.value); }}><option value="2">2 {t("developerSpaces")}</option><option value="4">4 {t("developerSpaces")}</option><option value="tab">Tab</option></select></label></div>}
        {tool.developerMode === "base64" && <div className="developer-options"><label>{t("developerBase64Format")}<select value={base64Mode} onChange={(event) => { resetResult(); setBase64Mode(event.target.value as "standard" | "url"); }}><option value="standard">Base64</option><option value="url">Base64url</option></select></label><label>{t("developerDirection")}<select value={direction} onChange={(event) => { resetResult(); setDirection(event.target.value as "encode" | "decode"); }}><option value="encode">{t("developerEncode")}</option><option value="decode">{t("developerDecode")}</option></select></label></div>}
        {tool.developerMode === "url" && <div className="developer-options"><label>{t("developerUrlMode")}<select value={urlMode} onChange={(event) => { resetResult(); setUrlMode(event.target.value as "component" | "url"); }}><option value="component">{t("developerParameterValue")}</option><option value="url">{t("developerFullUrl")}</option></select></label><label>{t("developerDirection")}<select value={direction} onChange={(event) => { resetResult(); setDirection(event.target.value as "encode" | "decode"); }}><option value="encode">{t("developerEncode")}</option><option value="decode">{t("developerDecode")}</option></select></label></div>}
        {tool.developerMode === "timestamp" && <div className="developer-options"><label>{t("developerDirection")}<select value={timestampDirection} onChange={(event) => { resetResult(); setTimestampDirection(event.target.value as "toDate" | "toTimestamp"); }}><option value="toDate">{t("developerTimestampToDate")}</option><option value="toTimestamp">{t("developerDateToTimestamp")}</option></select></label><label>{t("developerTimestampUnit")}<select value={timestampUnit} onChange={(event) => { resetResult(); setTimestampUnit(event.target.value as "seconds" | "milliseconds"); }}><option value="seconds">{t("developerSeconds")}</option><option value="milliseconds">{t("developerMilliseconds")}</option></select></label></div>}
        {tool.developerMode === "regex" && <div className="regex-config"><label>{t("developerPattern")}<input value={regexPattern} onChange={(event) => { resetResult(); setRegexPattern(event.target.value); }} spellCheck={false} /></label><fieldset><legend>{t("developerFlags")}</legend>{["d", "g", "i", "m", "s", "u", "v", "y"].filter((flag) => { try { new RegExp("", flag); return true; } catch { return false; } }).map((flag) => <label key={flag}><input type="checkbox" checked={regexFlags.includes(flag)} onChange={(event) => { resetResult(); setRegexFlags((current) => event.target.checked ? [...current, flag].filter((item) => !(flag === "u" && item === "v") && !(flag === "v" && item === "u")) : current.filter((item) => item !== flag)); }} />{flag}</label>)}</fieldset><label>{t("developerReplacement")}<input value={replacement} onChange={(event) => { resetResult(); setReplacement(event.target.value); }} /></label></div>}
        {tool.developerMode !== "timestamp" && <CodeEditor key={`${tool.developerMode}-source`} label={t("developerInput")} errorPosition={diagnostic?.side === "source" ? diagnostic.position : undefined} value={source} onChange={(value) => { setSource(value); resetResult(); }} language={tool.developerMode === "json" ? "json" : "text"} />}
        {tool.developerMode === "timestamp" && timestampDirection === "toDate" && <label className="developer-iso-field">{t("developerInput")}<input id="timestamp-source" inputMode="decimal" value={source} onChange={(event) => { resetResult(); setSource(event.target.value); }} spellCheck={false} placeholder="1761024000" /></label>}
        {tool.developerMode === "timestamp" && timestampDirection === "toTimestamp" && <label className="developer-iso-field">{t("developerIsoDateTime")}<input value={iso} onChange={(event) => { resetResult(); setIso(event.target.value); }} placeholder="2026-10-21T12:00:00+08:00" /></label>}
        {tool.developerMode === "diff" && <><h2 className="developer-secondary-title">{t("developerRight")}</h2><CodeEditor label={t("developerRight")} errorPosition={diagnostic?.side === "other" ? diagnostic.position : undefined} value={other} onChange={(value) => { setOther(value); resetResult(); }} language={diffMode === "json" ? "json" : "text"} /></>}
        {issue && <p className="developer-error" role="alert">{t(issue)}{diagnostic && <> · {t("developerErrorLocation", { line: (diagnostic.side === "other" ? other : source).slice(0, diagnostic.position).split("\n").length, column: diagnostic.position - (diagnostic.side === "other" ? other : source).lastIndexOf("\n", diagnostic.position - 1) })}</>}</p>}
        {tool.developerMode === "regex" && <p className="developer-hint">{t("developerRegexWorkerHint")}</p>}
        {tool.developerMode === "regex" && <p className="developer-hint">{t("developerFlagHelp")}</p>}
        <div className="developer-actions">
          {tool.developerMode === "json" && <button type="button" className="button-secondary" onClick={() => run(true)}>{t("developerMinify")}</button>}
          <button type="button" className="button-primary" onClick={() => run()} disabled={regexBusy}><Play size={16} />{regexBusy ? t("developerTesting") : t("developerRun")}</button>
          {regexBusy && <button type="button" className="button-secondary" onClick={cancelRegex}>{t("developerCancel")}</button>}
          <button type="button" className="button-secondary" onClick={selectAll}><RotateCcw size={16} />{t("clear")}</button>
          {undo && <button type="button" className="button-secondary" onClick={() => { resetResult(); setSource(undo.source); setOther(undo.other); setIso(undo.iso); setUndo(null); }}>{t("developerUndoClear")}</button>}
        </div>
      </fieldset>
      <div className="developer-panel developer-result-panel">
        <div className="developer-toolbar"><strong>{tool.developerMode === "regex" ? t("developerReplacementPreview") : t("result")}</strong>{hasResult && <div className="developer-toolbar-actions"><button type="button" className="button-secondary" onClick={() => void copy()}><Clipboard size={15} />{t("copyResult")}</button><button type="button" className="button-secondary" onClick={() => download()}><ArrowDownToLine size={15} />{t("download")}</button></div>}</div>
        {hasResult ? <pre className="developer-result" tabIndex={0} aria-label={t("result")} aria-live="polite">{result}</pre> : <div className="developer-empty-result">{t("developerRunToSeeResult")}</div>}
        {tool.developerMode === "regex" && regexMatches.length > 0 && <pre className="regex-highlight" aria-label={t("developerMatches")}>{(() => { let offset = 0; const parts = regexMatches.map((match, index) => { const before = source.slice(offset, match.index); offset = match.index + match.value.length; return <span key={index}>{before}<mark>{match.value || "▏"}</mark></span>; }); return <>{parts}{source.slice(offset)}</>; })()}</pre>}
        {tool.developerMode === "regex" && hasResult && <div className="regex-match-list"><h2>{t("developerMatches")} ({regexMatches.length})</h2>{regexMatches.map((match, index) => <div key={`${match.index}-${index}`}><span>{index + 1}.</span><code>{match.value}</code><small>{t("developerPosition", { position: match.index })}</small>{(match.captures.length > 0 || Object.keys(match.named).length > 0) && <code>{JSON.stringify({ captures: match.captures, named: match.named })}</code>}</div>)}</div>}
        {tool.developerMode === "timestamp" && <button className="button-secondary developer-now" type="button" onClick={() => { resetResult(); setSource(String(Math.floor(Date.now() / (timestampUnit === "seconds" ? 1000 : 1)))); setTimestampDirection("toDate"); }}>{t("developerFillNow")}</button>}
        <p className="developer-local-note"><Check size={15} />{t("developerLocalPrivacy")}</p>
      </div>
    </section>
  </main>;
}
