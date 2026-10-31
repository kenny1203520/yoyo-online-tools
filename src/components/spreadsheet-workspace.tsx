"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DataGrid, type CellKeyboardEvent, type CellKeyDownArgs, type CellMouseArgs, type Column, type PositionChangeArgs, type RenderEditCellContentProps } from "react-data-grid";
import { ArrowLeft, ArrowRight, Check, Download, FileSpreadsheet, LoaderCircle, RotateCcw, RotateCw, ShieldCheck, Table2, Upload } from "lucide-react";
import { createSpreadsheetWorker } from "@/lib/tool-workers";
import { parseCsvText, stringifyTsv } from "@/lib/spreadsheet-processing";
import { useI18n } from "@/lib/use-i18n";
import type { SpreadsheetCellPatch, SpreadsheetCellStyle, SpreadsheetCleanOptions, SpreadsheetCleanPreview, SpreadsheetCombineMode, SpreadsheetCombinePreview, SpreadsheetDocumentSummary, SpreadsheetEncoding, SpreadsheetFormat, SpreadsheetGridRow, SpreadsheetWorkerRequest, SpreadsheetWorkerResponse } from "@/lib/spreadsheet-types";
import type { SpreadsheetTool } from "@/lib/tools";

const PAGE_SIZE = 100;
type RequestPayload = SpreadsheetWorkerRequest extends infer Request
  ? Request extends { requestId: number } ? Omit<Request, "requestId"> : never
  : never;
type PendingRequest = { resolve: (response: SpreadsheetWorkerResponse) => void; reject: (error: Error) => void };

class SpreadsheetRequestError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

function cellText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function spreadsheetCellEditor({ row, column, onRowChange, onClose, label }: RenderEditCellContentProps<SpreadsheetGridRow> & { label: string }) {
  return <input
    autoFocus
    aria-label={label}
    value={cellText(row[column.key])}
    onChange={(event) => onRowChange({ ...row, [column.key]: event.target.value })}
    onBlur={() => onClose(true)}
    onKeyDown={(event) => {
      if (event.key === "Enter") { event.preventDefault(); onClose(true); }
      if (event.key === "Escape") { event.preventDefault(); onClose(false); }
    }}
  />;
}

function displayedValue(value: unknown, locale: string): string {
  void locale;
  return cellText(value);
}

function styleForCell(style?: SpreadsheetCellStyle): React.CSSProperties | undefined {
  if (!style) return undefined;
  const result: React.CSSProperties = {};
  if (style.color) result.color = style.color;
  if (style.backgroundColor) result.backgroundColor = style.backgroundColor;
  if (style.fontFamily) result.fontFamily = style.fontFamily;
  if (style.fontSize) result.fontSize = `${Math.round(style.fontSize * 4 / 3)}px`;
  if (style.bold) result.fontWeight = 700;
  if (style.italic) result.fontStyle = "italic";
  if (style.underline) result.textDecoration = "underline";
  if (style.horizontal) result.textAlign = style.horizontal;
  if (style.vertical) result.verticalAlign = style.vertical === "middle" ? "middle" : style.vertical;
  if (style.wrapText) result.whiteSpace = "normal";
  if (style.borderTop) result.borderTop = style.borderTop;
  if (style.borderRight) result.borderRight = style.borderRight;
  if (style.borderBottom) result.borderBottom = style.borderBottom;
  if (style.borderLeft) result.borderLeft = style.borderLeft;
  return result;
}

function updateSummary(items: SpreadsheetDocumentSummary[], updated: SpreadsheetDocumentSummary): SpreadsheetDocumentSummary[] {
  const index = items.findIndex((item) => item.id === updated.id);
  return index < 0 ? [...items, updated] : items.map((item) => item.id === updated.id ? updated : item);
}

export function SpreadsheetWorkspace({ tool }: { tool: SpreadsheetTool }) {
  const { t, locale, href } = useI18n();
  const toolName = tool.name[locale];
  const errorFallback = t("spreadsheetErrorFallback");
  const cellEditorLabel = t("spreadsheetCellEditorLabel");
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<number, PendingRequest>());
  const nextRequestId = useRef(0);
  const pageRequestId = useRef(0);
  const rowsRef = useRef<SpreadsheetGridRow[]>([]);
  const activeGridCellRef = useRef<{ rowIndex: number; columnIndex: number } | null>(null);
  const selectionAnchorRef = useRef<{ rowIndex: number; columnIndex: number } | null>(null);
  const extendingSelectionRef = useRef(false);
  const [documents, setDocuments] = useState<SpreadsheetDocumentSummary[]>([]);
  const [activeDocumentId, setActiveDocumentId] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<SpreadsheetGridRow[]>([]);
  const [loadedRowsKey, setLoadedRowsKey] = useState("");
  const [encoding, setEncoding] = useState<SpreadsheetEncoding>("utf-8");
  const [delimiter, setDelimiter] = useState("");
  const [hasHeader, setHasHeader] = useState(true);
  const [view, setView] = useState<"data" | "layout">("data");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fileName: string; value: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [cleanOptions, setCleanOptions] = useState<SpreadsheetCleanOptions>({ trimCells: true, removeEmptyRows: false, deduplicate: false, keyColumns: [0], requiredColumns: [] });
  const [cleanPreview, setCleanPreview] = useState<SpreadsheetCleanPreview | null>(null);
  const [mode, setMode] = useState<SpreadsheetCombineMode>("append");
  const [leftDocumentId, setLeftDocumentId] = useState("");
  const [rightDocumentId, setRightDocumentId] = useState("");
  const [leftSheetId, setLeftSheetId] = useState("");
  const [rightSheetId, setRightSheetId] = useState("");
  const [leftKeys, setLeftKeys] = useState(["0"]);
  const [rightKeys, setRightKeys] = useState(["0"]);
  const [combineHasHeader, setCombineHasHeader] = useState(true);
  const [combinePreview, setCombinePreview] = useState<SpreadsheetCombinePreview | null>(null);
  const [reviewed, setReviewed] = useState(false);
  const [rowPosition, setRowPosition] = useState(1);
  const [columnPosition, setColumnPosition] = useState(1);
  const [moveToPosition, setMoveToPosition] = useState(1);
  const [columnNameDraft, setColumnNameDraft] = useState<{ key: string; value: string } | null>(null);
  const [refreshRows, setRefreshRows] = useState(0);

  const ensureWorker = useCallback(() => {
    if (workerRef.current) return workerRef.current;
    const worker = createSpreadsheetWorker();
    worker.onmessage = (event: MessageEvent<SpreadsheetWorkerResponse>) => {
      const response = event.data;
      if (response.type === "progress") {
        setProgress({ fileName: response.fileName, value: response.progress });
        return;
      }
      const pending = pendingRef.current.get(response.requestId);
      if (!pending) return;
      pendingRef.current.delete(response.requestId);
      if (response.type === "error") pending.reject(new SpreadsheetRequestError(response.code, response.message));
      else pending.resolve(response);
    };
    worker.onerror = () => {
      for (const pending of pendingRef.current.values()) pending.reject(new Error("worker"));
      pendingRef.current.clear();
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
    workerRef.current = worker;
    return worker;
  }, []);

  const request = useCallback((payload: RequestPayload) => {
    const worker = ensureWorker();
    const requestId = ++nextRequestId.current;
    return new Promise<SpreadsheetWorkerResponse>((resolve, reject) => {
      pendingRef.current.set(requestId, { resolve, reject });
      try { worker.postMessage({ ...payload, requestId } as SpreadsheetWorkerRequest); }
      catch (cause) {
        pendingRef.current.delete(requestId);
        reject(cause instanceof Error ? cause : new Error("worker"));
      }
    });
  }, [ensureWorker]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    for (const pending of pendingRef.current.values()) pending.reject(new Error("cancelled"));
    pendingRef.current.clear();
  }, []);

  const activeDocument = documents.find((document) => document.id === activeDocumentId);
  const activeSheet = activeDocument?.sheets.find((sheet) => sheet.id === activeDocument.activeSheetId);
  const selectedColumnName = activeSheet?.headers[columnPosition - 1] ?? "";
  const columnNameKey = `${activeDocumentId}:${activeSheet?.id ?? ""}:${columnPosition}`;
  const newColumnName = columnNameDraft?.key === columnNameKey ? columnNameDraft.value : selectedColumnName;
  const leftDocument = documents.find((document) => document.id === leftDocumentId && !document.isResult);
  const rightDocument = documents.find((document) => document.id === rightDocumentId && !document.isResult);
  const leftSheet = leftDocument?.sheets.find((sheet) => sheet.id === leftSheetId) ?? leftDocument?.sheets[0];
  const rightSheet = rightDocument?.sheets.find((sheet) => sheet.id === rightSheetId) ?? rightDocument?.sheets[0];
  const pageCount = activeSheet ? Math.max(1, Math.ceil(activeSheet.dataRowCount / PAGE_SIZE)) : 1;
  const rowPageKey = activeDocument && activeSheet ? `${activeDocument.id}:${activeSheet.id}:${page}:${view}:${refreshRows}` : "";
  const rowsReady = rowPageKey !== "" && loadedRowsKey === rowPageKey;

  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => {
    activeGridCellRef.current = null;
    selectionAnchorRef.current = null;
    extendingSelectionRef.current = false;
  }, [rowPageKey]);
  useEffect(() => {
    if (!activeDocument || !activeSheet) return;
    const currentRequest = ++pageRequestId.current;
    let cancelled = false;
    void request({ type: "getRows", documentId: activeDocument.id, sheetId: activeSheet.id, start: page * PAGE_SIZE, count: PAGE_SIZE, includeStyles: view === "layout" })
      .then((response) => {
        if (!cancelled && currentRequest === pageRequestId.current && response.type === "rows") {
          setRows(response.rows);
          setLoadedRowsKey(`${activeDocument.id}:${activeSheet.id}:${page}:${view}:${refreshRows}`);
          setError("");
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled && currentRequest === pageRequestId.current) setError(cause instanceof SpreadsheetRequestError ? cause.message : errorFallback);
      });
    return () => { cancelled = true; };
  }, [activeDocument, activeSheet, page, view, refreshRows, request, errorFallback]);

  const syncDocument = useCallback((document: SpreadsheetDocumentSummary) => {
    setDocuments((current) => updateSummary(current, document));
  }, []);

  const fail = useCallback((cause: unknown) => {
    const code = cause instanceof SpreadsheetRequestError ? cause.code : "";
    const key = code === "unsupportedFormat" ? "spreadsheetErrorUnsupportedFormat"
      : code === "fileTooLarge" || code === "tableTooLarge" || code === "workbookTooLarge" || code === "workbookExpansionLimit" ? "spreadsheetErrorFileLimit"
        : code === "resultTooLarge" || code === "structureHistoryLimit" ? "spreadsheetErrorStructureLimit"
        : code === "malformedCsv" || code === "unsupportedEncoding" ? "spreadsheetErrorMalformedCsv"
          : code === "invalidWorkbook" || code === "emptyWorkbook" ? "spreadsheetErrorInvalidWorkbook"
            : code === "unsafeWorkbookEdit" || code === "unsafeWorkbookExport" ? "spreadsheetErrorProtectedContent"
              : code === "xlsxStructureBlocked" ? "spreadsheetErrorStructureUnsupported"
              : code === "referencesPreventStructuralChange" || code === "formulaPreventsCombine" || code === "formulaCellReadOnly" ? "spreadsheetErrorFormula"
                : code === "duplicateKey" ? "spreadsheetErrorDuplicateKeys"
                  : code === "staleResult" || code === "staleCleanPreview" ? "spreadsheetErrorStale"
                    : code === "resultNotConfirmed" ? "spreadsheetErrorReview"
                        : code === "pasteTooLarge" ? "spreadsheetErrorPasteLimit"
                        : code === "headerRequired" ? "spreadsheetErrorHeaderRequired"
                          : code === "columnNameInvalid" ? "spreadsheetErrorColumnName"
                            : code === "structurePositionInvalid" ? "spreadsheetErrorStructurePosition"
                        : "spreadsheetErrorGeneric";
    setError(`${t("spreadsheetError")}: ${t(key)}`);
  }, [t]);

  const handleImport = useCallback(async (files: FileList | null) => {
    if (!files?.length) return;
    if (documents.length > 0 && !window.confirm(t("spreadsheetNewImportConfirm"))) return;
    setLoading(true); setBusy(false); setProgress({ fileName: files[0]?.name ?? "", value: 0 }); setError(""); setNotice(""); setCleanPreview(null); setCombinePreview(null); setReviewed(false); setDocuments([]); setActiveDocumentId(""); setRows([]);
    try {
      const response = await request({ type: "load", files: [...files], options: { hasHeader, delimiter, encoding } });
      if (response.type !== "loaded") throw new Error("unexpected response");
      setDocuments(response.documents);
      setActiveDocumentId(response.documents[0]?.id ?? "");
      setPage(0); setView("data"); setRefreshRows((value) => value + 1);
      setLeftDocumentId(response.documents[0]?.id ?? "");
      setRightDocumentId(response.documents[1]?.id ?? response.documents[0]?.id ?? "");
      setCombineHasHeader(hasHeader);
      setNotice(t("spreadsheetDataLoaded"));
    } catch (cause) { fail(cause); }
    finally { setLoading(false); setProgress(null); }
  }, [delimiter, documents.length, encoding, fail, hasHeader, request, t]);

  const cancelImport = useCallback(() => {
    workerRef.current?.terminate(); workerRef.current = null;
    for (const pending of pendingRef.current.values()) pending.reject(new Error("cancelled"));
    pendingRef.current.clear();
    setLoading(false); setBusy(false); setProgress(null); setRows([]); setDocuments([]); setActiveDocumentId(""); setError(""); setNotice("");
  }, []);

  const changeHeader = useCallback(async (next: boolean) => {
    if (!activeDocument) return;
    setBusy(true); setError("");
    try {
      const response = await request({ type: "setHeader", documentId: activeDocument.id, hasHeader: next });
      if (response.type !== "updated") return;
      syncDocument(response.document); setPage(0); setCleanPreview(null); setCombinePreview(null); setRefreshRows((value) => value + 1); setHasHeader(next);
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, fail, request, syncDocument]);

  const changeSheet = useCallback(async (sheetId: string) => {
    if (!activeDocument) return;
    setBusy(true); setError("");
    try {
      const response = await request({ type: "setSheet", documentId: activeDocument.id, sheetId });
      if (response.type === "updated") { syncDocument(response.document); setPage(0); setCleanPreview(null); }
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, fail, request, syncDocument]);

  const savePatches = useCallback(async (documentId: string, sheetId: string, patches: SpreadsheetCellPatch[]) => {
    if (!patches.length) return;
    setBusy(true); setError("");
    try {
      const response = await request({ type: "editCells", documentId, sheetId, patches });
      if (response.type === "updated") syncDocument(response.document);
      setRefreshRows((value) => value + 1);
    } catch (cause) { fail(cause); setRefreshRows((value) => value + 1); }
    finally { setBusy(false); }
  }, [fail, request, syncDocument]);

  const columns = useMemo<Column<SpreadsheetGridRow>[]>(() => {
    if (!activeSheet) return [];
    const editable = Boolean(activeDocument && activeDocument.blockers.length === 0 && !activeSheet.hidden && !busy && !loading);
    const rowNumber: Column<SpreadsheetGridRow> = {
      key: "__rowNumber", name: "#", width: 64, minWidth: 64, maxWidth: 64, frozen: true,
      renderCell: ({ row }) => <span className="spreadsheet-row-number">{(page * PAGE_SIZE + row.__rowIndex + 1).toLocaleString(locale)}</span>,
    };
    return [rowNumber, ...activeSheet.headers.map((header, index): Column<SpreadsheetGridRow> => ({
      key: `column_${index}_${header}`, name: header, width: 180, minWidth: 120, resizable: true, editable,
      renderCell: ({ row }) => <div className="spreadsheet-cell-value" style={view === "layout" ? styleForCell(row.__cellStyles?.[index]) : undefined}>{displayedValue(row[`column_${index}`], locale)}</div>,
      renderEditCell: (props) => spreadsheetCellEditor({ ...props, label: cellEditorLabel }),
    }))];
  }, [activeDocument, activeSheet, busy, cellEditorLabel, loading, locale, page, view]);

  const onRowsChange = useCallback((nextRows: SpreadsheetGridRow[], data: { indexes: number[]; column: { idx: number; key: string } }) => {
    if (!activeDocument || !activeSheet) return;
    const oldRows = rowsRef.current;
    const patches: SpreadsheetCellPatch[] = [];
    for (const index of data.indexes) {
      const next = nextRows[index]; const previous = oldRows[index];
      if (!next || !previous) continue;
      const column = Number(data.column.key.replace(/^column_/u, ""));
      if (!Number.isInteger(column) || column < 0) continue;
      const before = cellText(previous[data.column.key]); const after = cellText(next[data.column.key]);
      if (before !== after) patches.push({ row: previous.__rowIndex, column, value: after });
    }
    setRows(nextRows); rowsRef.current = nextRows;
    if (patches.length) {
      setCleanPreview(null); setCombinePreview(null);
      void savePatches(activeDocument.id, activeSheet.id, patches);
    }
  }, [activeDocument, activeSheet, savePatches]);

  const onGridActivePositionChange = useCallback(({ rowIdx, column }: PositionChangeArgs<SpreadsheetGridRow>) => {
    if (!column || rowIdx < 0) return;
    const position = { rowIndex: rowIdx, columnIndex: column.idx };
    activeGridCellRef.current = position;
    if (extendingSelectionRef.current) extendingSelectionRef.current = false;
    else selectionAnchorRef.current = position;
  }, []);

  const onGridCellMouseDown = useCallback(({ rowIdx, column }: CellMouseArgs<SpreadsheetGridRow>) => {
    const position = { rowIndex: rowIdx, columnIndex: column.idx };
    activeGridCellRef.current = position;
    selectionAnchorRef.current = position;
    extendingSelectionRef.current = false;
  }, []);

  const onGridCellKeyDown = useCallback((args: CellKeyDownArgs<SpreadsheetGridRow>, event: CellKeyboardEvent) => {
    if (args.mode !== "ACTIVE" || !args.column) return;
    const position = { rowIndex: args.rowIdx, columnIndex: args.column.idx };
    if (event.shiftKey && event.key.startsWith("Arrow")) {
      selectionAnchorRef.current ??= position;
      extendingSelectionRef.current = true;
      return;
    }
    if (event.key.startsWith("Arrow") || event.key === "Tab") {
      selectionAnchorRef.current = position;
      extendingSelectionRef.current = false;
    }
  }, []);

  const onCellCopy = useCallback((args: { column: { key: string; idx: number }; row: SpreadsheetGridRow }, event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!args.column.key.startsWith("column_")) return;
    const fallbackRow = rowsRef.current.findIndex((row) => row.__rowIndex === args.row.__rowIndex);
    const active = activeGridCellRef.current ?? { rowIndex: Math.max(0, fallbackRow), columnIndex: args.column.idx };
    const anchor = selectionAnchorRef.current ?? active;
    const firstRow = Math.max(0, Math.min(anchor.rowIndex, active.rowIndex));
    const lastRow = Math.min(rowsRef.current.length - 1, Math.max(anchor.rowIndex, active.rowIndex));
    const firstColumn = Math.max(1, Math.min(anchor.columnIndex, active.columnIndex));
    const lastColumn = Math.min(activeSheet?.columnCount ?? 0, Math.max(anchor.columnIndex, active.columnIndex));
    if (lastRow < firstRow || lastColumn < firstColumn) return;
    const cells = (lastRow - firstRow + 1) * (lastColumn - firstColumn + 1);
    if (cells > 50_000) {
      setError(`${t("spreadsheetError")}: ${t("spreadsheetErrorCopyLimit")}`);
      event.preventDefault();
      return;
    }
    const matrix = rowsRef.current.slice(firstRow, lastRow + 1).map((row) =>
      Array.from({ length: lastColumn - firstColumn + 1 }, (_, offset) => row[`column_${firstColumn - 1 + offset}`] as string | number | boolean | null | undefined),
    );
    event.clipboardData.setData("text/plain", stringifyTsv(matrix));
    event.preventDefault();
  }, [activeSheet?.columnCount, t]);

  const onCellPaste = useCallback((args: { column: { idx: number; key: string }; row: SpreadsheetGridRow }, event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!activeDocument || !activeSheet || !args.column.key.startsWith("column_")) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    try {
      if (text.length > 5_000_000) throw new SpreadsheetRequestError("pasteTooLarge", "Paste fewer than 50,000 cells at a time.");
      const matrix = parseCsvText(text, "\t").rows;
      const patches = matrix.flatMap((row, rowOffset) => row.map((value, columnOffset) => ({ row: args.row.__rowIndex + rowOffset, column: args.column.idx - 1 + columnOffset, value: value === null ? "" : String(value) })));
      if (patches.length > 50_000 || matrix.length > 250) throw new SpreadsheetRequestError("pasteTooLarge", "Paste fewer than 50,000 cells at a time.");
      if (patches.some((patch) => patch.row >= activeSheet.dataRowCount || patch.column >= activeSheet.columnCount)) throw new SpreadsheetRequestError("cellOutOfBounds", "The pasted range falls outside the current table. No cells were changed.");
      setCleanPreview(null); setCombinePreview(null);
      void savePatches(activeDocument.id, activeSheet.id, patches);
      return args.row;
    } catch (cause) { fail(cause); }
  }, [activeDocument, activeSheet, fail, savePatches]);

  const undo = useCallback(async () => {
    if (!activeDocument?.canUndo) return;
    setBusy(true); setError("");
    try {
      const response = await request({ type: "undo", documentId: activeDocument.id });
      if (response.type === "updated") { syncDocument(response.document); setRefreshRows((value) => value + 1); setCleanPreview(null); setCombinePreview(null); }
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, fail, request, syncDocument]);
  const redo = useCallback(async () => {
    if (!activeDocument?.canRedo) return;
    setBusy(true); setError("");
    try {
      const response = await request({ type: "redo", documentId: activeDocument.id });
      if (response.type === "updated") { syncDocument(response.document); setRefreshRows((value) => value + 1); setCleanPreview(null); setCombinePreview(null); }
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, fail, request, syncDocument]);

  const changeStructure = useCallback(async (axis: "row" | "column", operation: "insert" | "delete") => {
    if (!activeDocument || !activeSheet) return;
    const position = axis === "row" ? rowPosition : columnPosition;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request({ type: "structure", documentId: activeDocument.id, sheetId: activeSheet.id, axis, operation, index: position - 1 });
      if (response.type !== "updated") return;
      syncDocument(response.document); setCleanPreview(null); setCombinePreview(null); setReviewed(false); setColumnNameDraft(null); setRefreshRows((value) => value + 1);
      const nextSheet = response.document.sheets.find((sheet) => sheet.id === activeSheet.id);
      if (axis === "row" && nextSheet) setPage((current) => Math.min(current, Math.max(0, Math.ceil(nextSheet.dataRowCount / PAGE_SIZE) - 1)));
      if (axis === "column" && nextSheet) {
        setColumnPosition((current) => Math.max(1, Math.min(current, nextSheet.columnCount)));
        setMoveToPosition((current) => Math.max(1, Math.min(current, nextSheet.columnCount)));
      }
      setNotice(t("spreadsheetDataLoaded"));
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, activeSheet, columnPosition, fail, request, rowPosition, syncDocument, t]);

  const renameColumn = useCallback(async () => {
    if (!activeDocument || !activeSheet) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request({ type: "renameColumn", documentId: activeDocument.id, sheetId: activeSheet.id, column: columnPosition - 1, name: newColumnName });
      if (response.type !== "updated") return;
      syncDocument(response.document); setCleanPreview(null); setCombinePreview(null); setReviewed(false); setColumnNameDraft(null); setRefreshRows((value) => value + 1);
      setNotice(t("spreadsheetDataLoaded"));
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, activeSheet, columnPosition, fail, newColumnName, request, syncDocument, t]);

  const moveColumn = useCallback(async () => {
    if (!activeDocument || !activeSheet) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request({ type: "moveColumn", documentId: activeDocument.id, sheetId: activeSheet.id, from: columnPosition - 1, to: moveToPosition - 1 });
      if (response.type !== "updated") return;
      syncDocument(response.document); setCleanPreview(null); setCombinePreview(null); setReviewed(false); setColumnNameDraft(null); setRefreshRows((value) => value + 1);
      setNotice(t("spreadsheetDataLoaded"));
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, activeSheet, columnPosition, fail, moveToPosition, request, syncDocument, t]);

  const previewCleaning = useCallback(async () => {
    if (!activeDocument || !activeSheet) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request({ type: "previewClean", documentId: activeDocument.id, sheetId: activeSheet.id, options: cleanOptions });
      if (response.type === "cleanPreview") setCleanPreview(response.preview);
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, activeSheet, cleanOptions, fail, request]);

  const applyCleaning = useCallback(async () => {
    if (!cleanPreview) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await request({ type: "applyClean", planId: cleanPreview.planId });
      if (response.type !== "cleanApplied") return;
      setDocuments((current) => updateSummary(current, response.document)); setActiveDocumentId(response.document.id); setPage(0); setView("data"); setRefreshRows((value) => value + 1); setCleanPreview(null); setReviewed(false);
      setNotice(t("spreadsheetReviewResult"));
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [cleanPreview, fail, request, t]);

  const runCombine = useCallback(async () => {
    if (!leftDocument || !rightDocument || !leftSheet || !rightSheet) return;
    setBusy(true); setError(""); setNotice(""); setCombinePreview(null); setReviewed(false);
    try {
      const response = await request({ type: "combine", options: {
        mode, leftDocumentId: leftDocument.id, leftSheetId: leftSheet.id, rightDocumentId: rightDocument.id, rightSheetId: rightSheet.id,
        hasHeader: combineHasHeader, leftKeyColumns: mode === "append" ? [] : leftKeys.map(Number), rightKeyColumns: mode === "append" ? [] : rightKeys.map(Number),
      } });
      if (response.type !== "combinePreview") return;
      setCombinePreview(response.preview);
      if (response.preview.result) {
        setDocuments((current) => updateSummary(current, response.preview.result!)); setActiveDocumentId(response.preview.result.id); setPage(0); setView("data"); setRefreshRows((value) => value + 1); setNotice(t("spreadsheetReviewResult"));
      }
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [combineHasHeader, fail, leftDocument, leftKeys, leftSheet, mode, request, rightDocument, rightKeys, rightSheet, t]);

  const confirmResult = useCallback(async () => {
    if (!activeDocument?.isResult || !reviewed) return;
    setBusy(true); setError("");
    try {
      const response = await request({ type: "confirmResult", documentId: activeDocument.id });
      if (response.type === "resultConfirmed") { syncDocument(response.document); setReviewed(false); setNotice(t("spreadsheetResultConfirmed")); }
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, fail, request, reviewed, syncDocument, t]);

  const download = useCallback(async (format: SpreadsheetFormat) => {
    if (!activeDocument || !activeSheet) return;
    setBusy(true); setError("");
    try {
      const response = await request({ type: "export", documentId: activeDocument.id, sheetId: activeSheet.id, format });
      if (response.type !== "exported") return;
      const url = URL.createObjectURL(new Blob([response.buffer], { type: response.mimeType }));
      const link = document.createElement("a"); link.href = url; link.download = response.fileName; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { fail(cause); }
    finally { setBusy(false); }
  }, [activeDocument, activeSheet, fail, request]);

  const canEdit = Boolean(activeDocument && activeSheet && activeDocument.blockers.length === 0 && !activeSheet.hidden && !busy && !loading);
  const sourceTables = documents.filter((document) => !document.isResult);
  const availableFormats: SpreadsheetFormat[] = activeDocument?.format === "xlsx" ? (activeDocument.isResult ? ["xlsx", "csv"] : ["xlsx"]) : ["csv", "xlsx"];

  return <main className="main-shell spreadsheet-page">
    <header className="spreadsheet-intro">
      <div className="spreadsheet-eyebrow"><Table2 size={16} aria-hidden="true" />{t("spreadsheetTools")}</div>
      <h1>{toolName}</h1>
      <p>{t("spreadsheetDescription")}</p>
      <p className="spreadsheet-privacy"><ShieldCheck size={16} aria-hidden="true" />{t("spreadsheetPrivacyNote")}</p>
      <p className="spreadsheet-session-note">{t("spreadsheetWorkSession")}</p>
    </header>

    <section className="spreadsheet-panel" aria-labelledby="spreadsheet-import-title">
      <div className="spreadsheet-panel-heading"><h2 id="spreadsheet-import-title"><Upload size={18} aria-hidden="true" />{t("spreadsheetChooseFiles")}</h2><span className="spreadsheet-local-badge"><ShieldCheck size={15} aria-hidden="true" />{t("localProcessing")}</span></div>
      <div className="spreadsheet-import-grid">
        <label className="spreadsheet-field spreadsheet-file-field">{t("spreadsheetChooseFiles")}<input type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" multiple disabled={loading} onChange={(event) => { void handleImport(event.target.files); event.currentTarget.value = ""; }} /></label>
        <label className="spreadsheet-field">{t("spreadsheetEncoding")}<select value={encoding} disabled={loading} onChange={(event) => setEncoding(event.target.value as SpreadsheetEncoding)}><option value="utf-8">{t("spreadsheetUtf8")}</option><option value="big5">{t("spreadsheetBig5")}</option><option value="shift_jis">{t("spreadsheetShiftJis")}</option><option value="windows-1252">{t("spreadsheetWindows1252")}</option></select></label>
        <label className="spreadsheet-field">{t("spreadsheetDelimiter")}<select value={delimiter} disabled={loading} onChange={(event) => setDelimiter(event.target.value)}><option value="">{t("spreadsheetAutoDelimiter")}</option><option value=",">{t("spreadsheetComma")}</option><option value="\t">{t("spreadsheetTab")}</option><option value=";">{t("spreadsheetSemicolon")}</option></select></label>
        <label className="spreadsheet-check"><input type="checkbox" checked={hasHeader} disabled={loading} onChange={(event) => { setHasHeader(event.target.checked); }} />{t("spreadsheetHeaderRow")}</label>
      </div>
      <p className="spreadsheet-help">{t("spreadsheetFileLimit")} {t("spreadsheetUnsupportedFiles")}</p>
      {loading && <div className="spreadsheet-progress"><span>{t("spreadsheetImporting")}: {progress?.fileName}</span><progress aria-label={t("spreadsheetProgress")} max={100} value={progress?.value ?? 0} /><span>{progress?.value ?? 0}%</span><button type="button" className="button-secondary" onClick={cancelImport}>{t("spreadsheetCancel")}</button></div>}
    </section>

    {error && <p className="spreadsheet-error" role="alert">{error}</p>}
    <p className="spreadsheet-live-status" role="status" aria-live="polite">{busy ? t("spreadsheetSavingEdit") : notice}</p>

    {!activeDocument && !loading && <div className="spreadsheet-empty"><FileSpreadsheet size={28} aria-hidden="true" /><p>{t("spreadsheetEmptyState")}</p></div>}

    {activeDocument && activeSheet && <>
      <section className="spreadsheet-panel" aria-labelledby="spreadsheet-data-title">
        <div className="spreadsheet-panel-heading spreadsheet-data-heading">
          <h2 id="spreadsheet-data-title"><FileSpreadsheet size={18} aria-hidden="true" />{activeDocument.isResult ? t("spreadsheetResultLabel") : activeDocument.fileName}</h2>
          <label className="spreadsheet-field spreadsheet-document-select">{t("spreadsheetSource")}<select value={activeDocument.id} onChange={(event) => { setActiveDocumentId(event.target.value); setPage(0); setCleanPreview(null); setReviewed(false); }}>
            {documents.map((document) => <option key={document.id} value={document.id}>{document.isResult ? `✦ ${document.fileName}` : document.fileName}</option>)}
          </select></label>
        </div>

        <div className="spreadsheet-toolbar">
          <label className="spreadsheet-field">{t("spreadsheetSheet")}<select value={activeSheet.id} onChange={(event) => { void changeSheet(event.target.value); }} disabled={busy}>{activeDocument.sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}{sheet.hidden ? " · hidden" : ""}</option>)}</select></label>
          <label className="spreadsheet-check"><input type="checkbox" checked={activeDocument.hasHeader} onChange={(event) => { void changeHeader(event.target.checked); }} disabled={busy} />{t("spreadsheetHeaderRow")}</label>
          <div className="spreadsheet-view-toggle" role="group" aria-label={t("spreadsheetDataView")}>
            <button type="button" aria-pressed={view === "data"} onClick={() => setView("data")}>{t("spreadsheetDataView")}</button>
            <button type="button" aria-pressed={view === "layout"} onClick={() => setView("layout")} disabled={activeDocument.format !== "xlsx"}>{t("spreadsheetLayoutView")}</button>
          </div>
          <div className="spreadsheet-undo-actions">
            <button type="button" className="button-secondary" onClick={() => { void undo(); }} disabled={!activeDocument.canUndo || busy} aria-label={t("spreadsheetUndo")}><RotateCcw size={17} aria-hidden="true" />{t("spreadsheetUndo")}</button>
            <button type="button" className="button-secondary" onClick={() => { void redo(); }} disabled={!activeDocument.canRedo || busy} aria-label={t("spreadsheetRedo")}><RotateCw size={17} aria-hidden="true" />{t("spreadsheetRedo")}</button>
          </div>
        </div>

        <div className="spreadsheet-stats"><span>{t("spreadsheetRows")}: {activeSheet.dataRowCount.toLocaleString(locale)}</span><span>{t("spreadsheetColumns")}: {activeSheet.columnCount.toLocaleString(locale)}</span><span>{t("spreadsheetPage")}: {page + 1} / {pageCount}</span>{activeDocument.modified && !activeDocument.isResult && <span>{t("spreadsheetSourceModified")}</span>}</div>
        {view === "layout" && <p className="spreadsheet-help">{t("spreadsheetLayoutUnavailable")}</p>}
        {activeDocument.formulaCount > 0 && <p className="spreadsheet-warning">{t("spreadsheetFormulaNotice")}</p>}
        {activeDocument.blockers.length > 0 && <div className="spreadsheet-blockers"><strong>{t("spreadsheetBlockers")}</strong><ul>{activeDocument.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}

        {activeSheet.dataRowCount > 0 && rowsReady ? <>
          <div className="spreadsheet-grid-region" role="region" aria-labelledby="spreadsheet-grid-heading" tabIndex={0}>
            <h3 id="spreadsheet-grid-heading" className="sr-only">{t("spreadsheetGridRegion")}</h3>
            <DataGrid key={activeSheet.headers.join("\u001f")} className={`spreadsheet-grid${view === "layout" ? " is-layout" : ""}`} columns={columns} rows={rows} rowKeyGetter={(row) => row.__rowIndex} rowHeight={44} headerRowHeight={48} aria-label={t("spreadsheetGridRegion")} aria-rowcount={activeSheet.dataRowCount + 1} onRowsChange={onRowsChange} onCellCopy={onCellCopy} onCellPaste={onCellPaste} onCellKeyDown={onGridCellKeyDown} onCellMouseDown={onGridCellMouseDown} onActivePositionChange={onGridActivePositionChange} data-testid="spreadsheet-grid" />
          </div>
          <p className="spreadsheet-help">{t("spreadsheetPageHint")}</p>
          <div className="spreadsheet-pagination"><span>{t("spreadsheetCurrentPage")} {page + 1} / {pageCount}</span><button type="button" className="button-secondary" onClick={() => setPage((value) => Math.max(0, value - 1))} disabled={page === 0 || busy}><ArrowLeft size={16} aria-hidden="true" />{t("spreadsheetPreviousPage")}</button><button type="button" className="button-secondary" onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))} disabled={page >= pageCount - 1 || busy}>{t("spreadsheetNextPage")}<ArrowRight size={16} aria-hidden="true" /></button></div>
        </> : activeSheet.dataRowCount > 0 ? <p className="spreadsheet-empty-rows" role="status"><LoaderCircle size={20} className="spreadsheet-spinner" aria-hidden="true" />{t("spreadsheetImporting")}</p> : <p className="spreadsheet-empty-rows">{t("spreadsheetNoDataRows")}</p>}

        {activeDocument.isResult && <div className="spreadsheet-review-box">
          <p>{activeDocument.resultConfirmed ? t("spreadsheetResultConfirmed") : t("spreadsheetReviewResult")}</p>
          {!activeDocument.resultConfirmed && <>
            <label className="spreadsheet-check"><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={busy} />{t("spreadsheetConfirmReview")}</label>
            <button type="button" className="button-primary" onClick={() => { void confirmResult(); }} disabled={!reviewed || busy}><Check size={17} aria-hidden="true" />{t("spreadsheetConfirmResult")}</button>
          </>}
        </div>}
        <div className="spreadsheet-downloads">
          {availableFormats.map((format) => <button key={format} type="button" className="button-primary" onClick={() => { void download(format); }} disabled={busy || activeDocument.blockers.length > 0 || (activeDocument.isResult && !activeDocument.resultConfirmed)}><Download size={17} aria-hidden="true" />{format === "csv" ? t("spreadsheetExportCsv") : t("spreadsheetExportXlsx")}</button>)}
        </div>
      </section>

      <div className="spreadsheet-tools-grid">
        <section className="spreadsheet-panel" aria-labelledby="spreadsheet-structure-title">
          <h2 id="spreadsheet-structure-title">{t("spreadsheetStructurePanel")}</h2>
          <p className="spreadsheet-help">{t("spreadsheetStructureHelp")}</p>
          <label className="spreadsheet-field">{t("spreadsheetRowPosition")}<input type="number" inputMode="numeric" min={1} max={activeSheet.dataRowCount + 1} value={rowPosition} onChange={(event) => setRowPosition(Math.max(1, Number(event.target.value) || 1))} disabled={!activeDocument.supportsStructure || busy} /></label>
          <div className="spreadsheet-action-row">
            <button type="button" className="button-secondary" onClick={() => { void changeStructure("row", "insert"); }} disabled={!activeDocument.supportsStructure || busy}><Table2 size={17} aria-hidden="true" />{t("spreadsheetInsertRow")}</button>
            <button type="button" className="button-secondary" onClick={() => { void changeStructure("row", "delete"); }} disabled={!activeDocument.supportsStructure || activeSheet.dataRowCount === 0 || rowPosition > activeSheet.dataRowCount || busy}>{t("spreadsheetDeleteRow")}</button>
          </div>
          <label className="spreadsheet-field">{t("spreadsheetColumnPosition")}<input type="number" inputMode="numeric" min={1} max={activeSheet.columnCount + 1} value={columnPosition} onChange={(event) => setColumnPosition(Math.max(1, Number(event.target.value) || 1))} disabled={!activeDocument.supportsStructure || busy} /></label>
          <p className="spreadsheet-help">{t("spreadsheetMoveSource")}</p>
          <div className="spreadsheet-action-row">
            <button type="button" className="button-secondary" onClick={() => { void changeStructure("column", "insert"); }} disabled={!activeDocument.supportsStructure || busy}><Table2 size={17} aria-hidden="true" />{t("spreadsheetInsertColumn")}</button>
            <button type="button" className="button-secondary" onClick={() => { void changeStructure("column", "delete"); }} disabled={!activeDocument.supportsStructure || activeSheet.columnCount === 0 || columnPosition > activeSheet.columnCount || busy}>{t("spreadsheetDeleteColumn")}</button>
          </div>
          <label className="spreadsheet-field">{t("spreadsheetNewColumnName")}<input type="text" maxLength={1024} value={newColumnName} onChange={(event) => setColumnNameDraft({ key: columnNameKey, value: event.target.value })} disabled={!activeDocument.supportsStructure || !activeDocument.hasHeader || busy} /></label>
          <button type="button" className="button-secondary" onClick={() => { void renameColumn(); }} disabled={!activeDocument.supportsStructure || !activeDocument.hasHeader || !newColumnName.trim() || !activeSheet.columnCount || busy}><Table2 size={17} aria-hidden="true" />{t("spreadsheetRenameColumn")}</button>
          <label className="spreadsheet-field">{t("spreadsheetMoveTo")}<input type="number" inputMode="numeric" min={1} max={activeSheet.columnCount} value={moveToPosition} onChange={(event) => setMoveToPosition(Math.max(1, Number(event.target.value) || 1))} disabled={!activeDocument.supportsStructure || !activeSheet.columnCount || busy} /></label>
          <button type="button" className="button-secondary" onClick={() => { void moveColumn(); }} disabled={!activeDocument.supportsStructure || !activeSheet.columnCount || columnPosition > activeSheet.columnCount || moveToPosition > activeSheet.columnCount || busy}><Table2 size={17} aria-hidden="true" />{t("spreadsheetMoveColumn")}</button>
        </section>
        <section className="spreadsheet-panel" aria-labelledby="spreadsheet-clean-title">
          <h2 id="spreadsheet-clean-title">{t("spreadsheetCleanPanel")}</h2>
          <div className="spreadsheet-clean-options">
            <label className="spreadsheet-check"><input type="checkbox" checked={cleanOptions.trimCells} onChange={(event) => { setCleanOptions((value) => ({ ...value, trimCells: event.target.checked })); setCleanPreview(null); }} disabled={!canEdit} />{t("spreadsheetTrimCells")}</label>
            <label className="spreadsheet-check"><input type="checkbox" checked={cleanOptions.removeEmptyRows} onChange={(event) => { setCleanOptions((value) => ({ ...value, removeEmptyRows: event.target.checked })); setCleanPreview(null); }} disabled={!canEdit || activeDocument.formulaCount > 0 || activeSheet.mergedCellCount > 0} />{t("spreadsheetRemoveEmptyRows")}</label>
            <label className="spreadsheet-check"><input type="checkbox" checked={cleanOptions.deduplicate} onChange={(event) => { setCleanOptions((value) => ({ ...value, deduplicate: event.target.checked })); setCleanPreview(null); }} disabled={!canEdit || activeDocument.formulaCount > 0 || activeSheet.mergedCellCount > 0} />{t("spreadsheetDeduplicate")}</label>
          </div>
          <label className="spreadsheet-field">{t("spreadsheetKeyColumn")}<select multiple size={Math.min(4, Math.max(2, activeSheet.headers.length))} value={cleanOptions.keyColumns.map(String)} onChange={(event) => { setCleanOptions((value) => ({ ...value, keyColumns: [...event.currentTarget.selectedOptions].map((option) => Number(option.value)) })); setCleanPreview(null); }} disabled={!canEdit || !activeSheet.columnCount}>{activeSheet.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label>
          <label className="spreadsheet-field">{t("spreadsheetRequiredColumn")}<select multiple size={Math.min(4, Math.max(2, activeSheet.headers.length))} value={cleanOptions.requiredColumns.map(String)} onChange={(event) => { setCleanOptions((value) => ({ ...value, requiredColumns: [...event.currentTarget.selectedOptions].map((option) => Number(option.value)) })); setCleanPreview(null); }} disabled={!canEdit || !activeSheet.columnCount}>{activeSheet.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label>
          <div className="spreadsheet-action-row"><button type="button" className="button-secondary" onClick={() => { void previewCleaning(); }} disabled={!canEdit || busy}><Table2 size={17} aria-hidden="true" />{t("spreadsheetPreview")}</button><button type="button" className="button-primary" onClick={() => { void applyCleaning(); }} disabled={!cleanPreview || busy}><Check size={17} aria-hidden="true" />{t("spreadsheetApplyCleaning")}</button></div>
          <div className="spreadsheet-preview-summary" aria-live="polite"><h3>{t("spreadsheetPreviewSummary")}</h3>{cleanPreview ? <dl>
            <div><dt>{t("spreadsheetTrimmedCount")}</dt><dd>{cleanPreview.trimmedCells.toLocaleString(locale)}</dd></div><div><dt>{t("spreadsheetEmptyRowsCount")}</dt><dd>{cleanPreview.removedEmptyRows.toLocaleString(locale)}</dd></div><div><dt>{t("spreadsheetDuplicateRowsCount")}</dt><dd>{cleanPreview.removedDuplicates.toLocaleString(locale)}</dd></div><div><dt>{t("spreadsheetMissingFieldsCount")}</dt><dd>{cleanPreview.missingRequiredRows.toLocaleString(locale)}</dd></div><div><dt>{t("spreadsheetMissingRequiredRowNumbers")}</dt><dd>{cleanPreview.missingRequiredRowNumbers.join(", ") || "—"}</dd></div><div><dt>{t("spreadsheetAffectedRows")}</dt><dd>{cleanPreview.affectedRows.join(", ") || "—"}</dd></div>
          </dl> : <p>{t("spreadsheetNoPreview")}</p>}</div>
        </section>

        <section className="spreadsheet-panel" aria-labelledby="spreadsheet-combine-title">
          <h2 id="spreadsheet-combine-title">{t("spreadsheetOperations")}</h2>
          <label className="spreadsheet-field">{t("spreadsheetOperation")}<select value={mode} onChange={(event) => { setMode(event.target.value as SpreadsheetCombineMode); setCombinePreview(null); }}><option value="append">{t("spreadsheetAppend")}</option><option value="join">{t("spreadsheetJoin")}</option><option value="compare">{t("spreadsheetCompare")}</option></select></label>
          <div className="spreadsheet-pair-grid">
            <fieldset><legend>{t("spreadsheetLeftTable")}</legend><label className="spreadsheet-field"><span className="sr-only">{t("spreadsheetLeftTable")}</span><select aria-label={t("spreadsheetLeftTable")} value={leftDocumentId} onChange={(event) => { setLeftDocumentId(event.target.value); setLeftSheetId(""); setCombinePreview(null); }} disabled={!sourceTables.length}>{sourceTables.map((document) => <option key={document.id} value={document.id}>{document.fileName}</option>)}</select></label><label className="spreadsheet-field"><span className="sr-only">{t("spreadsheetSheet")}</span><select aria-label={`${t("spreadsheetLeftTable")} ${t("spreadsheetSheet")}`} value={leftSheet?.id ?? ""} onChange={(event) => { setLeftSheetId(event.target.value); setCombinePreview(null); }}>{leftDocument?.sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}</select></label>{mode !== "append" && <label className="spreadsheet-field">{t("spreadsheetLeftKey")}<select multiple size={Math.min(4, Math.max(2, leftSheet?.headers.length ?? 2))} value={leftKeys} onChange={(event) => setLeftKeys([...event.currentTarget.selectedOptions].map((option) => option.value))}>{leftSheet?.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label>}</fieldset>
            <fieldset><legend>{t("spreadsheetRightTable")}</legend><label className="spreadsheet-field"><span className="sr-only">{t("spreadsheetRightTable")}</span><select aria-label={t("spreadsheetRightTable")} value={rightDocumentId} onChange={(event) => { setRightDocumentId(event.target.value); setRightSheetId(""); setCombinePreview(null); }} disabled={!sourceTables.length}>{sourceTables.map((document) => <option key={document.id} value={document.id}>{document.fileName}</option>)}</select></label><label className="spreadsheet-field"><span className="sr-only">{t("spreadsheetSheet")}</span><select aria-label={`${t("spreadsheetRightTable")} ${t("spreadsheetSheet")}`} value={rightSheet?.id ?? ""} onChange={(event) => { setRightSheetId(event.target.value); setCombinePreview(null); }}>{rightDocument?.sheets.map((sheet) => <option key={sheet.id} value={sheet.id}>{sheet.name}</option>)}</select></label>{mode !== "append" && <label className="spreadsheet-field">{t("spreadsheetRightKey")}<select multiple size={Math.min(4, Math.max(2, rightSheet?.headers.length ?? 2))} value={rightKeys} onChange={(event) => setRightKeys([...event.currentTarget.selectedOptions].map((option) => option.value))}>{rightSheet?.headers.map((header, index) => <option key={index} value={index}>{header}</option>)}</select></label>}</fieldset>
          </div>
          <label className="spreadsheet-check"><input type="checkbox" checked={combineHasHeader} onChange={(event) => setCombineHasHeader(event.target.checked)} />{t("spreadsheetHeaderRow")}</label>
          <button type="button" className="button-primary" onClick={() => { void runCombine(); }} disabled={!leftDocument || !rightDocument || !leftSheet || !rightSheet || (mode !== "append" && (!leftKeys.length || !rightKeys.length)) || busy}><Table2 size={17} aria-hidden="true" />{t("spreadsheetRunOperation")}</button>
          {combinePreview && <div className="spreadsheet-preview-summary" aria-live="polite">
            {combinePreview.conflicts.length > 0 ? <><p className="spreadsheet-warning">{t("spreadsheetConflicts")}</p><ul>{combinePreview.conflicts.slice(0, 20).map((conflict, index) => <li key={`${conflict.key}-${index}`}>{conflict.key}: {t("spreadsheetConflictRows")} {conflict.rows.join(", ")}</li>)}</ul></> : <dl>
              {combinePreview.matchedRows !== undefined && <div><dt>{t("spreadsheetMatchedRows")}</dt><dd>{combinePreview.matchedRows.toLocaleString(locale)}</dd></div>}
              {combinePreview.unmatchedRows !== undefined && <div><dt>{t("spreadsheetUnmatchedRows")}</dt><dd>{combinePreview.unmatchedRows.toLocaleString(locale)}</dd></div>}
              {combinePreview.addedRows !== undefined && <div><dt>{t("spreadsheetAddedRows")}</dt><dd>{combinePreview.addedRows.toLocaleString(locale)}</dd></div>}
              {combinePreview.removedRows !== undefined && <div><dt>{t("spreadsheetRemovedRows")}</dt><dd>{combinePreview.removedRows.toLocaleString(locale)}</dd></div>}
              {combinePreview.changedRows !== undefined && <div><dt>{t("spreadsheetChangedRows")}</dt><dd>{combinePreview.changedRows.toLocaleString(locale)}</dd></div>}
              {combinePreview.result && <p>{t("spreadsheetReviewResult")}</p>}
            </dl>}
          </div>}
        </section>
      </div>
    </>}

    <footer className="spreadsheet-footer"><Link href={href("/#tools")}><ArrowLeft size={16} aria-hidden="true" />{t("backToAllTools")}</Link></footer>
  </main>;
}
