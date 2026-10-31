import ExcelJS, { type CellValue, type Worksheet } from "exceljs";
import JSZip from "jszip";
import Papa from "papaparse";
import {
  appendTables,
  compareTables,
  detectCsvDelimiter,
  isEmptyCell,
  joinTables,
  parseCsvText,
  stringifyCsv,
  tableKey,
  type TableCell,
  type TableRows,
} from "./spreadsheet-processing";
import type {
  SpreadsheetCellPatch,
  SpreadsheetCellStyle,
  SpreadsheetCleanOptions,
  SpreadsheetCleanPreview,
  SpreadsheetCombinePreview,
  SpreadsheetCombineRequest,
  SpreadsheetDocumentSummary,
  SpreadsheetEncoding,
  SpreadsheetFormat,
  SpreadsheetGridRow,
  SpreadsheetImportOptions,
  SpreadsheetSheetSummary,
} from "./spreadsheet-types";

const MAX_CSV_BYTES = 100 * 1024 * 1024;
const MAX_XLSX_BYTES = 50 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024;
const MAX_ZIP_ENTRY_BYTES = 512 * 1024 * 1024;
const MAX_EXPANSION_RATIO = 250;
const MAX_ROWS = 1_000_000;
const MAX_COLUMNS = 1_000;
const MAX_CELLS = 20_000_000;
const MAX_RESULT_CELLS = 20_000_000;
const MAX_EDIT_CELLS = 50_000;
const MAX_HISTORY_COMMANDS = 50;
const MAX_STRUCTURE_HISTORY_CELLS = 250_000;
const DEFAULT_PAGE_SIZE = 250;

type InternalSheet = {
  id: string;
  name: string;
  worksheet?: Worksheet;
  csvRows?: TableRows;
  rowCount: number;
  columnCount: number;
  hidden: boolean;
  formulaCount: number;
  mergedCellCount: number;
};

type HistoryValue = CellValue | undefined;
type HistoryCommand =
  | { kind: "cells"; sheetId: string; changes: Array<{ row: number; column: number; before: HistoryValue; after: HistoryValue }> }
  | { kind: "structure"; sheetId: string; axis: "row" | "column"; operation: "insert" | "delete"; index: number; removedValues?: HistoryValue[]; beforeLengths?: number[] }
  | { kind: "columnHeader"; sheetId: string; column: number; before: HistoryValue; after: HistoryValue }
  | { kind: "columnMove"; sheetId: string; from: number; to: number }
  | { kind: "header"; before: boolean; after: boolean };

type InternalDocument = {
  id: string;
  fileName: string;
  format: SpreadsheetFormat;
  fileSize: number;
  hasHeader: boolean;
  delimiter: string;
  encoding: SpreadsheetEncoding;
  activeSheetId: string;
  sheets: Map<string, InternalSheet>;
  workbook?: ExcelJS.Workbook;
  formulaCount: number;
  blockers: string[];
  version: number;
  modified: boolean;
  isResult: boolean;
  resultConfirmed: boolean;
  sourceVersions?: Array<{ documentId: string; version: number }>;
  undoStack?: HistoryCommand[];
  redoStack?: HistoryCommand[];
};

type CleanPlan = {
  id: string;
  documentId: string;
  sheetId: string;
  version: number;
  options: SpreadsheetCleanOptions;
  rowsToRemove: number[];
  preview: SpreadsheetCleanPreview;
};

export type SpreadsheetEngineProgress = (fileName: string, progress: number) => void;

export class SpreadsheetEngineError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SpreadsheetEngineError";
  }
}

function formatFromName(fileName: string): SpreadsheetFormat {
  const lower = fileName.toLocaleLowerCase("en");
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";
  if (lower.endsWith(".xls") || lower.endsWith(".xlsm") || lower.endsWith(".xlsb")) {
    throw new SpreadsheetEngineError("unsupportedFormat", "Only CSV and XLSX files are supported. XLS, XLSM and XLSB files are not accepted.");
  }
  throw new SpreadsheetEngineError("unsupportedFormat", "Choose a CSV or XLSX file.");
}

function formulaResult(value: CellValue): CellValue {
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  if (("formula" in value || "sharedFormula" in value) && "result" in value) return value.result as CellValue;
  return value;
}

function toTableCell(value: CellValue): TableCell {
  const plain = formulaResult(value);
  if (plain === null || plain === undefined) {
    if (value && typeof value === "object" && "formula" in value) return `=${value.formula}`;
    if (value && typeof value === "object" && "sharedFormula" in value) return `=${value.sharedFormula}`;
    return null;
  }
  if (plain instanceof Date) return plain.toISOString();
  if (typeof plain === "string" || typeof plain === "number" || typeof plain === "boolean") return plain;
  if (typeof plain === "object") {
    if ("richText" in plain && Array.isArray(plain.richText)) return plain.richText.map((part) => part.text).join("");
    if ("text" in plain && typeof plain.text === "string") return plain.text;
    if ("error" in plain && typeof plain.error === "string") return plain.error;
    if ("formula" in plain && typeof plain.formula === "string") return `=${plain.formula}`;
  }
  return String(plain);
}

function isFormulaValue(value: CellValue): boolean {
  return Boolean(value && typeof value === "object" && !(value instanceof Date) && ("formula" in value || "sharedFormula" in value));
}

function colorHex(color: { argb?: string } | undefined): string | undefined {
  const argb = color?.argb;
  if (typeof argb !== "string") return undefined;
  const hex = argb.length === 8 ? argb.slice(2) : argb;
  return /^[\da-f]{6}$/iu.test(hex) ? `#${hex}` : undefined;
}

function borderCss(border: Partial<ExcelJS.Border> | undefined): string | undefined {
  if (!border?.style) return undefined;
  const widths: Record<string, number> = { hair: 1, thin: 1, dotted: 1, dashed: 1, dashDot: 1, medium: 2, mediumDashed: 2, thick: 3, double: 3 };
  const width = widths[border.style] ?? 1;
  const style = border.style === "double" ? "double" : border.style.toLowerCase().includes("dash") || border.style === "dotted" ? "dashed" : "solid";
  return `${width}px ${style} ${colorHex(border.color) ?? "#d7ded9"}`;
}

function cellStyle(cell: ExcelJS.Cell): SpreadsheetCellStyle | undefined {
  const style: SpreadsheetCellStyle = {};
  const font = cell.font;
  const fill = cell.fill;
  const patternFill = fill && "fgColor" in fill ? fill : undefined;
  const backgroundColor = colorHex(patternFill?.fgColor);
  const color = colorHex(font?.color);
  if (color) style.color = color;
  if (backgroundColor) style.backgroundColor = backgroundColor;
  if (font?.name) style.fontFamily = font.name;
  if (font?.size) style.fontSize = font.size;
  if (font?.bold) style.bold = true;
  if (font?.italic) style.italic = true;
  if (font?.underline) style.underline = true;
  if (cell.alignment?.horizontal === "left" || cell.alignment?.horizontal === "center" || cell.alignment?.horizontal === "right") style.horizontal = cell.alignment.horizontal;
  if (cell.alignment?.vertical === "top" || cell.alignment?.vertical === "middle" || cell.alignment?.vertical === "bottom") style.vertical = cell.alignment.vertical;
  if (cell.alignment?.wrapText) style.wrapText = true;
  if (cell.numFmt) style.numberFormat = cell.numFmt;
  style.borderTop = borderCss(cell.border?.top);
  style.borderRight = borderCss(cell.border?.right);
  style.borderBottom = borderCss(cell.border?.bottom);
  style.borderLeft = borderCss(cell.border?.left);
  return Object.values(style).some((value) => value !== undefined) ? style : undefined;
}

function usedColumnCount(worksheet: Worksheet): number {
  return worksheet.columnCount;
}

function dataRowCount(document: InternalDocument, sheet: InternalSheet): number {
  return Math.max(0, sheet.rowCount - (document.hasHeader ? 1 : 0));
}

function summarySheet(document: InternalDocument, sheet: InternalSheet): SpreadsheetSheetSummary {
  const headerRow = document.hasHeader ? readWorksheetRow(sheet, 1) as TableCell[] : [];
  return {
    id: sheet.id,
    name: sheet.name,
    rowCount: sheet.rowCount,
    dataRowCount: dataRowCount(document, sheet),
    columnCount: sheet.columnCount,
    headers: Array.from({ length: sheet.columnCount }, (_, column) => document.hasHeader ? headerLabel(headerRow, column) : `Column ${column + 1}`),
    hidden: sheet.hidden,
    formulaCount: sheet.formulaCount,
    mergedCellCount: sheet.mergedCellCount,
  };
}

function summary(document: InternalDocument): SpreadsheetDocumentSummary {
  return {
    id: document.id,
    fileName: document.fileName,
    format: document.format,
    fileSize: document.fileSize,
    hasHeader: document.hasHeader,
    delimiter: document.delimiter,
    encoding: document.encoding,
    activeSheetId: document.activeSheetId,
    sheets: [...document.sheets.values()].map((sheet) => summarySheet(document, sheet)),
    formulaCount: document.formulaCount,
    blockers: [...document.blockers],
    version: document.version,
    modified: document.modified,
    isResult: document.isResult,
    resultConfirmed: document.resultConfirmed,
    sourceVersions: document.sourceVersions ? [...document.sourceVersions] : undefined,
    canUndo: Boolean(document.undoStack?.length),
    canRedo: Boolean(document.redoStack?.length),
    supportsStructure: !document.workbook && document.blockers.length === 0 && document.formulaCount === 0,
  };
}

function safeWorksheetName(name: string): string {
  const cleaned = name.replace(/[\\/?*:[\]]/gu, " ").trim().slice(0, 31);
  return cleaned || "Sheet1";
}

function readWorksheetRow(sheet: InternalSheet, physicalRow: number, includeStyles = false): TableCell[] | { values: TableCell[]; styles: Array<SpreadsheetCellStyle | undefined> } {
  if (sheet.csvRows) {
    const values = sheet.csvRows[physicalRow - 1] ?? [];
    return includeStyles ? { values, styles: values.map(() => undefined) } : values;
  }
  const worksheet = sheet.worksheet;
  if (!worksheet) return [];
  const row = worksheet.getRow(physicalRow);
  const values: TableCell[] = [];
  const styles: Array<SpreadsheetCellStyle | undefined> = [];
  for (let column = 1; column <= sheet.columnCount; column++) {
    const cell = row.getCell(column);
    values.push(toTableCell(cell.value));
    if (includeStyles) styles.push(cellStyle(cell));
  }
  return includeStyles ? { values, styles } : values;
}

function rowsForSheet(document: InternalDocument, sheet: InternalSheet): TableRows {
  if (sheet.csvRows) return sheet.csvRows;
  const rows: TableRows = [];
  for (let row = 1; row <= sheet.rowCount; row++) rows.push(readWorksheetRow(sheet, row) as TableCell[]);
  return rows;
}

function estimateCells(rows: readonly (readonly TableCell[])[]): number {
  let count = 0;
  for (const row of rows) count += row.length;
  return count;
}

function inspectBlockedFeatures(zip: JSZip): string[] {
  const blockers = new Set<string>();
  const patterns: Array<[RegExp, string]> = [
    [/^xl\/(?:charts|drawings|media)\//iu, "Charts, drawings or embedded images are present."],
    [/^xl\/(?:pivotTables|pivotCache|slicerCaches|slicers)\//iu, "Pivot tables or slicers are present."],
    [/^xl\/(?:externalLinks|connections|queryTables|model)\//iu, "External links or data connections are present."],
    [/^xl\/tables\//iu, "Excel table ranges are present; editing is disabled until their references can be preserved safely."],
    [/^xl\/(?:activeX|ctrlProps|embeddings|richData|threadedComments|persons|metadata)\//iu, "Embedded objects, threaded comments or extended workbook data are present."],
    [/(?:^|\/)vbaProject\.bin$/iu, "VBA or macro content is present."],
    [/^customXml\//iu, "Custom XML content is present."],
    [/^customUI\//iu, "Custom workbook interface content is present."],
  ];
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    for (const [pattern, message] of patterns) if (pattern.test(path)) blockers.add(message);
  }
  return [...blockers];
}

async function scanXlsxPackage(buffer: ArrayBuffer): Promise<string[]> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, { checkCRC32: false });
  } catch {
    throw new SpreadsheetEngineError("invalidWorkbook", "This XLSX file is encrypted, damaged or not a valid workbook.");
  }

  let totalUncompressed = 0;
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const metadata = entry as typeof entry & { _data?: { uncompressedSize?: number; compressedSize?: number } };
    const uncompressed = metadata._data?.uncompressedSize ?? 0;
    const compressed = metadata._data?.compressedSize ?? 0;
    totalUncompressed += uncompressed;
    if (uncompressed > MAX_ZIP_ENTRY_BYTES || totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      throw new SpreadsheetEngineError("workbookTooLarge", "The uncompressed workbook exceeds the safe processing limit.");
    }
    if (compressed > 0 && uncompressed / compressed > MAX_EXPANSION_RATIO) {
      throw new SpreadsheetEngineError("workbookExpansionLimit", "A workbook part expands beyond the safe compression ratio.");
    }
  }
  const blockers = inspectBlockedFeatures(zip);
  for (const [path, entry] of Object.entries(zip.files)) {
    if (!entry.dir && /^(?:xl\/workbook\.xml|xl\/worksheets\/sheet\d+\.xml|\[Content_Types\]\.xml)$/iu.test(path)) {
      const xml = await entry.async("string");
      if (path === "xl/workbook.xml" && /<(?:\w+:)?definedNames\b/iu.test(xml)) blockers.push("Named ranges are present and cannot yet be guaranteed after editing or export.");
      if (/<(?:\w+:)?extLst\b/iu.test(xml)) blockers.push("An OOXML extension block is present and cannot be guaranteed to survive export.");
    }
  }
  return [...new Set(blockers)];
}

function cellValueLooksFormula(value: CellValue): boolean {
  return Boolean(value && typeof value === "object" && !(value instanceof Date) && ("formula" in value || "sharedFormula" in value));
}

async function parseCsvFile(
  file: File,
  encoding: SpreadsheetEncoding,
  preferredDelimiter: string,
  onProgress: (progress: number) => void,
): Promise<{ rows: TableRows; delimiter: string }> {
  const sample = await file.slice(0, Math.min(file.size, 512 * 1024)).arrayBuffer();
  let sampleText: string;
  try {
    sampleText = new TextDecoder(encoding, { fatal: false }).decode(sample);
  } catch {
    throw new SpreadsheetEngineError("unsupportedEncoding", "This browser does not support the selected file encoding.");
  }
  const detected = preferredDelimiter || detectCsvDelimiter(sampleText);
  const rows: TableRows = [];
  let cellCount = 0;
  const canStreamFile = typeof Reflect.get(globalThis, "FileReaderSync") === "function";
  const parsedFile = canStreamFile ? new Promise<{ rows: TableRows; delimiter: string }>((resolve, reject) => {
    Papa.parse<string[]>(file, {
      delimiter: detected,
      encoding,
      dynamicTyping: false,
      skipEmptyLines: false,
      chunkSize: 1024 * 1024,
      worker: false,
      chunk(result, parser) {
        const malformed = result.errors.find((error) => error.type === "Quotes" && error.code === "MissingQuotes");
        if (malformed) {
          reject(new SpreadsheetEngineError("malformedCsv", `CSV row ${malformed.row ?? 0}: ${malformed.message}`));
          parser.abort();
          return;
        }
        for (const row of result.data) { rows.push(row); cellCount += row.length; }
        if (rows.length > MAX_ROWS || cellCount > MAX_CELLS) {
          reject(new SpreadsheetEngineError("tableTooLarge", "This CSV exceeds the supported row or cell count."));
          parser.abort();
          return;
        }
        onProgress(Math.min(95, Math.round((result.meta.cursor / Math.max(1, file.size)) * 95)));
      },
      complete() {
        resolve({ rows, delimiter: detected });
      },
      error(error) {
        reject(new SpreadsheetEngineError("malformedCsv", error.message));
      },
    });
  }) : file.arrayBuffer().then((buffer) => {
    // FileReaderSync is available in browser workers. Node-based verification uses
    // the string parser because Papa Parse's File streamer requires that browser API.
    const text = new TextDecoder(encoding, { fatal: false }).decode(buffer);
    const result = Papa.parse<string[]>(text, { delimiter: detected, dynamicTyping: false, skipEmptyLines: false });
    const malformed = result.errors.find((error) => error.type === "Quotes" && error.code === "MissingQuotes");
    if (malformed) throw new SpreadsheetEngineError("malformedCsv", `CSV row ${malformed.row ?? 0}: ${malformed.message}`);
    for (const row of result.data) { rows.push(row); cellCount += row.length; }
    if (rows.length > MAX_ROWS || cellCount > MAX_CELLS) {
      throw new SpreadsheetEngineError("tableTooLarge", "This CSV exceeds the supported row or cell count.");
    }
    onProgress(95);
    return { rows, delimiter: detected };
  });
  return parsedFile.then(async (parsed) => {
    if (file.size > 0) {
      const ending = await file.slice(Math.max(0, file.size - 2)).arrayBuffer();
      const endingText = new TextDecoder(encoding, { fatal: false }).decode(ending);
      if (/[\r\n]$/u.test(endingText) && parsed.rows.at(-1)?.every((cell) => cell === "")) parsed.rows.pop();
    }
    return parsed;
  });
}

function headerLabel(headers: readonly TableCell[], column: number): string {
  const value = headers[column];
  return value === null || value === undefined || String(value).trim() === "" ? `Column ${column + 1}` : String(value);
}

function spreadsheetRow(document: InternalDocument, sheet: InternalSheet, dataRowIndex: number, includeStyles: boolean): SpreadsheetGridRow {
  const physicalRow = dataRowIndex + (document.hasHeader ? 2 : 1);
  const loaded = readWorksheetRow(sheet, physicalRow, includeStyles);
  const values = Array.isArray(loaded) ? loaded : loaded.values;
  const row: SpreadsheetGridRow = { __rowIndex: dataRowIndex };
  for (let column = 0; column < sheet.columnCount; column++) row[`column_${column}`] = values[column] ?? null;
  if (!Array.isArray(loaded)) row.__cellStyles = loaded.styles;
  return row;
}

function workbookSummary(workbook: ExcelJS.Workbook, initialId: number): { sheets: Map<string, InternalSheet>; formulaCount: number } {
  const sheets = new Map<string, InternalSheet>();
  let formulaCount = 0;
  for (const worksheet of workbook.worksheets) {
    let sheetFormulaCount = 0;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cellValueLooksFormula(cell.value)) sheetFormulaCount++;
      });
    });
    formulaCount += sheetFormulaCount;
    const merges = worksheet.model.merges?.length ?? 0;
    const sheet: InternalSheet = {
      id: String(worksheet.id || initialId),
      name: worksheet.name,
      worksheet,
      rowCount: worksheet.rowCount,
      columnCount: usedColumnCount(worksheet),
      hidden: worksheet.state !== "visible",
      formulaCount: sheetFormulaCount,
      mergedCellCount: merges,
    };
    sheets.set(sheet.id, sheet);
  }
  return { sheets, formulaCount };
}

function validateDimensions(rowCount: number, columnCount: number, fileName: string): void {
  if (rowCount > MAX_ROWS || columnCount > MAX_COLUMNS || rowCount * Math.max(1, columnCount) > MAX_CELLS) {
    throw new SpreadsheetEngineError("tableTooLarge", `${fileName} exceeds the supported row, column or cell count.`);
  }
}

function asTransferableBuffer(buffer: ArrayBuffer | Uint8Array): ArrayBuffer {
  if (buffer instanceof ArrayBuffer) return buffer;
  return new Uint8Array(buffer).buffer as ArrayBuffer;
}

export class SpreadsheetEngine {
  private readonly documents = new Map<string, InternalDocument>();
  private readonly cleanPlans = new Map<string, CleanPlan>();
  private nextDocumentId = 1;
  private nextPlanId = 1;

  reset(): void {
    this.documents.clear();
    this.cleanPlans.clear();
    this.nextDocumentId = 1;
    this.nextPlanId = 1;
  }

  listDocuments(): SpreadsheetDocumentSummary[] {
    return [...this.documents.values()].map(summary);
  }

  async importFiles(files: File[], options: SpreadsheetImportOptions, onProgress: SpreadsheetEngineProgress): Promise<SpreadsheetDocumentSummary[]> {
    if (files.length === 0) throw new SpreadsheetEngineError("noFiles", "Choose at least one file.");
    for (const file of files) {
      const format = formatFromName(file.name);
      const maxBytes = format === "csv" ? MAX_CSV_BYTES : MAX_XLSX_BYTES;
      if (file.size > maxBytes) throw new SpreadsheetEngineError("fileTooLarge", `${file.name} exceeds the ${format === "csv" ? "100 MiB" : "50 MiB"} file size limit.`);
    }
    this.reset();
    for (const file of files) {
      const id = `sheetdoc-${this.nextDocumentId++}`;
      const format = formatFromName(file.name);
      if (format === "csv") {
        const parsed = await parseCsvFile(file, options.encoding, options.delimiter, (progress) => onProgress(file.name, progress));
        const columnCount = parsed.rows.reduce((max, row) => Math.max(max, row.length), 0);
        validateDimensions(parsed.rows.length, columnCount, file.name);
        const sheet: InternalSheet = {
          id: "csv-sheet-1",
          name: file.name.replace(/\.csv$/iu, "") || "Data",
          csvRows: parsed.rows,
          rowCount: parsed.rows.length,
          columnCount,
          hidden: false,
          formulaCount: 0,
          mergedCellCount: 0,
        };
        this.documents.set(id, {
          id,
          fileName: file.name,
          format,
          fileSize: file.size,
          hasHeader: options.hasHeader,
          delimiter: parsed.delimiter,
          encoding: options.encoding,
          activeSheetId: sheet.id,
          sheets: new Map([[sheet.id, sheet]]),
          formulaCount: 0,
          blockers: [],
          version: 0,
          modified: false,
          isResult: false,
          resultConfirmed: false,
        });
        onProgress(file.name, 100);
        continue;
      }

      const buffer = await file.arrayBuffer();
      const blockers = await scanXlsxPackage(buffer);
      onProgress(file.name, 20);
      const workbook = new ExcelJS.Workbook();
      try {
        await workbook.xlsx.load(buffer);
      } catch {
        throw new SpreadsheetEngineError("invalidWorkbook", `${file.name} could not be opened as a valid XLSX workbook.`);
      }
      const metadata = workbookSummary(workbook, this.nextDocumentId);
      if (metadata.sheets.size === 0) throw new SpreadsheetEngineError("emptyWorkbook", `${file.name} contains no worksheets.`);
      let totalRows = 0;
      let totalCells = 0;
      for (const sheet of metadata.sheets.values()) {
        validateDimensions(sheet.rowCount, sheet.columnCount, file.name);
        totalRows += sheet.rowCount;
        totalCells += sheet.rowCount * sheet.columnCount;
      }
      validateDimensions(totalRows, Math.max(1, ...[...metadata.sheets.values()].map((sheet) => sheet.columnCount)), file.name);
      if (totalCells > MAX_CELLS) throw new SpreadsheetEngineError("tableTooLarge", `${file.name} contains too many workbook cells to edit safely.`);
      const activeSheetId = metadata.sheets.values().next().value?.id ?? "1";
      const mergeCount = [...metadata.sheets.values()].reduce((count, sheet) => count + sheet.mergedCellCount, 0);
      if (mergeCount > 0) blockers.push("Merged cells are present; direct edits and structural changes are disabled to protect references.");
      this.documents.set(id, {
        id,
        fileName: file.name,
        format,
        fileSize: file.size,
        hasHeader: options.hasHeader,
        delimiter: ",",
        encoding: options.encoding,
        activeSheetId,
        sheets: metadata.sheets,
        workbook,
        formulaCount: metadata.formulaCount,
        blockers: [...new Set(blockers)],
        version: 0,
        modified: false,
        isResult: false,
        resultConfirmed: false,
      });
      onProgress(file.name, 100);
    }
    return this.listDocuments();
  }

  getRows(documentId: string, sheetId: string, start: number, count: number, includeStyles: boolean): SpreadsheetGridRow[] {
    const document = this.requireDocument(documentId);
    const sheet = this.requireSheet(document, sheetId);
    const from = Math.max(0, Math.min(start, dataRowCount(document, sheet)));
    const limit = Math.max(0, Math.min(count, DEFAULT_PAGE_SIZE));
    const to = Math.min(from + limit, dataRowCount(document, sheet));
    return Array.from({ length: to - from }, (_, index) => spreadsheetRow(document, sheet, from + index, includeStyles));
  }

  setHeader(documentId: string, hasHeader: boolean): SpreadsheetDocumentSummary {
    const document = this.requireDocument(documentId);
    if (document.hasHeader !== hasHeader) {
      const before = document.hasHeader;
      document.hasHeader = hasHeader;
      document.version++;
      document.modified = true;
      if (document.isResult) document.resultConfirmed = false;
      this.recordHistory(document, { kind: "header", before, after: hasHeader });
    }
    return summary(document);
  }

  setSheet(documentId: string, sheetId: string): SpreadsheetDocumentSummary {
    const document = this.requireDocument(documentId);
    this.requireSheet(document, sheetId);
    document.activeSheetId = sheetId;
    return summary(document);
  }

  editCells(documentId: string, sheetId: string, patches: SpreadsheetCellPatch[]): SpreadsheetDocumentSummary {
    const document = this.requireEditable(documentId);
    const sheet = this.requireSheet(document, sheetId);
    if (sheet.hidden) throw new SpreadsheetEngineError("hiddenSheet", "Hidden worksheets are read-only.");
    if (patches.length > MAX_EDIT_CELLS) throw new SpreadsheetEngineError("pasteTooLarge", "Paste fewer than 50,000 cells at a time.");
    const normalized = new Map<string, SpreadsheetCellPatch>();
    for (const patch of patches) {
      if (!Number.isInteger(patch.row) || patch.row < 0 || patch.row >= dataRowCount(document, sheet)
        || !Number.isInteger(patch.column) || patch.column < 0 || patch.column >= sheet.columnCount) {
        throw new SpreadsheetEngineError("cellOutOfBounds", "A pasted cell falls outside the current table. No cells were changed.");
      }
      if (!sheet.csvRows) {
        const cell = sheet.worksheet!.getCell(patch.row + (document.hasHeader ? 2 : 1), patch.column + 1);
        if (isFormulaValue(cell.value)) throw new SpreadsheetEngineError("formulaCellReadOnly", "Formula cells cannot be overwritten directly.");
      }
      normalized.set(`${patch.row}:${patch.column}`, patch);
    }
    if (normalized.size === 0) return summary(document);
    const changes = [...normalized.values()].map((patch) => {
      const physicalRow = patch.row + (document.hasHeader ? 2 : 1);
      const before = sheet.csvRows ? sheet.csvRows[physicalRow - 1]?.[patch.column] : sheet.worksheet!.getCell(physicalRow, patch.column + 1).value;
      return { row: patch.row, column: patch.column, before, after: patch.value };
    });
    for (const change of changes) {
      this.writeCellValue(document, sheet, change.row, change.column, change.after);
    }
    document.version++;
    document.modified = true;
    if (document.isResult) document.resultConfirmed = false;
    this.recordHistory(document, { kind: "cells", sheetId, changes });
    if (document.workbook && document.formulaCount > 0) {
      document.workbook.calcProperties.fullCalcOnLoad = true;
    }
    return summary(document);
  }

  editStructure(documentId: string, sheetId: string, axis: "row" | "column", operation: "insert" | "delete", index: number): SpreadsheetDocumentSummary {
    const document = this.requireEditable(documentId);
    const sheet = this.requireSheet(document, sheetId);
    if (sheet.hidden) throw new SpreadsheetEngineError("hiddenSheet", "Hidden worksheets are read-only.");
    if (document.workbook) throw new SpreadsheetEngineError("xlsxStructureBlocked", "Inserting or deleting XLSX rows and columns is blocked until row styles and workbook references pass the preservation tests. Cell edits remain available.");
    if (document.formulaCount > 0) throw new SpreadsheetEngineError("referencesPreventStructuralChange", "Formula cells are present. Structural edits are disabled to protect references.");
    if (document.sheets.size > 0 && [...document.sheets.values()].some((entry) => entry.mergedCellCount > 0)) {
      throw new SpreadsheetEngineError("referencesPreventStructuralChange", "Merged cells are present. Structural edits are disabled to protect references.");
    }
    if (axis === "column" && operation === "delete" && sheet.rowCount > MAX_STRUCTURE_HISTORY_CELLS) {
      throw new SpreadsheetEngineError("structureHistoryLimit", "Deleting a column from this many rows would exceed the safe undo history limit.");
    }
    const result = this.applyStructure(document, sheet, axis, operation, index);
    document.version++;
    document.modified = true;
    if (document.isResult) document.resultConfirmed = false;
    this.recordHistory(document, { kind: "structure", sheetId, axis, operation, index, ...result });
    return summary(document);
  }

  renameColumn(documentId: string, sheetId: string, column: number, name: string): SpreadsheetDocumentSummary {
    const document = this.requireEditable(documentId);
    const sheet = this.requireSheet(document, sheetId);
    if (sheet.hidden) throw new SpreadsheetEngineError("hiddenSheet", "Hidden worksheets are read-only.");
    if (!sheet.csvRows) throw new SpreadsheetEngineError("xlsxStructureBlocked", "Renaming XLSX columns is blocked until workbook references and styles pass the preservation tests.");
    if (!document.hasHeader) throw new SpreadsheetEngineError("headerRequired", "Turn on the header row before renaming columns.");
    if (!Number.isInteger(column) || column < 0 || column >= sheet.columnCount) {
      throw new SpreadsheetEngineError("structurePositionInvalid", "Choose a column inside the table. No cells were changed.");
    }
    if (!name.trim() || name.length > 1024) throw new SpreadsheetEngineError("columnNameInvalid", "Column names must contain 1 to 1024 characters.");
    const header = sheet.csvRows[0];
    if (!header) throw new SpreadsheetEngineError("headerRequired", "This table does not have a header row.");
    const before = header[column];
    if (before === name) return summary(document);
    header.splice(column, 1, name);
    document.version++;
    document.modified = true;
    if (document.isResult) document.resultConfirmed = false;
    this.recordHistory(document, { kind: "columnHeader", sheetId, column, before, after: name });
    return summary(document);
  }

  moveColumn(documentId: string, sheetId: string, from: number, to: number): SpreadsheetDocumentSummary {
    const document = this.requireEditable(documentId);
    const sheet = this.requireSheet(document, sheetId);
    if (sheet.hidden) throw new SpreadsheetEngineError("hiddenSheet", "Hidden worksheets are read-only.");
    if (!sheet.csvRows) throw new SpreadsheetEngineError("xlsxStructureBlocked", "Reordering XLSX columns is blocked until workbook references and styles pass the preservation tests.");
    if (!Number.isInteger(from) || from < 0 || from >= sheet.columnCount
      || !Number.isInteger(to) || to < 0 || to >= sheet.columnCount) {
      throw new SpreadsheetEngineError("structurePositionInvalid", "Choose columns inside the table. No cells were changed.");
    }
    if (from === to) return summary(document);
    this.applyColumnMove(sheet, from, to);
    document.version++;
    document.modified = true;
    if (document.isResult) document.resultConfirmed = false;
    this.recordHistory(document, { kind: "columnMove", sheetId, from, to });
    return summary(document);
  }

  undo(documentId: string): SpreadsheetDocumentSummary {
    const document = this.requireDocument(documentId);
    const command = document.undoStack?.pop();
    if (!command) return summary(document);
    this.applyHistoryCommand(document, command, "undo");
    document.redoStack ??= [];
    document.redoStack.push(command);
    document.version++;
    document.modified = true;
    if (document.isResult) document.resultConfirmed = false;
    if (document.workbook && document.formulaCount > 0) document.workbook.calcProperties.fullCalcOnLoad = true;
    return summary(document);
  }

  redo(documentId: string): SpreadsheetDocumentSummary {
    const document = this.requireDocument(documentId);
    const command = document.redoStack?.pop();
    if (!command) return summary(document);
    this.applyHistoryCommand(document, command, "redo");
    document.undoStack ??= [];
    document.undoStack.push(command);
    document.version++;
    document.modified = true;
    if (document.isResult) document.resultConfirmed = false;
    if (document.workbook && document.formulaCount > 0) document.workbook.calcProperties.fullCalcOnLoad = true;
    return summary(document);
  }

  previewClean(documentId: string, sheetId: string, options: SpreadsheetCleanOptions): SpreadsheetCleanPreview {
    const document = this.requireEditable(documentId);
    const sheet = this.requireSheet(document, sheetId);
    if (sheet.hidden) throw new SpreadsheetEngineError("hiddenSheet", "Hidden worksheets are read-only.");
    const removesRows = options.removeEmptyRows || options.deduplicate;
    if (removesRows && (document.formulaCount > 0 || sheet.mergedCellCount > 0)) {
      throw new SpreadsheetEngineError("referencesPreventStructuralChange", "This workbook contains formulas or merged cells. Row-removing operations are disabled to protect references.");
    }
    const rowsToRemove: number[] = [];
    const seen = new Set<string>();
    let trimmedCells = 0;
    let removedEmptyRows = 0;
    let removedDuplicates = 0;
    let missingRequiredRows = 0;
    const missingRequiredRowNumbers: number[] = [];
    const affectedRows: number[] = [];
    const startRow = document.hasHeader ? 2 : 1;
    for (let physicalRow = 1; physicalRow <= sheet.rowCount; physicalRow++) {
      const values = readWorksheetRow(sheet, physicalRow) as TableCell[];
      const outputValues = values.map((value) => {
        if (typeof value !== "string" || !options.trimCells) return value;
        const trimmed = value.trim();
        if (trimmed !== value) trimmedCells++;
        return trimmed;
      });
      const isHeader = document.hasHeader && physicalRow === 1;
      if (options.trimCells && outputValues.some((value, index) => !Object.is(value, values[index]))) {
        if (affectedRows.length < 20) affectedRows.push(physicalRow - startRow + 1);
      }
      if (isHeader || physicalRow < startRow) continue;
      if (options.removeEmptyRows && outputValues.every(isEmptyCell)) {
        rowsToRemove.push(physicalRow);
        removedEmptyRows++;
        if (affectedRows.length < 20) affectedRows.push(physicalRow - startRow + 1);
        continue;
      }
      if (options.deduplicate) {
        const key = tableKey(outputValues, options.keyColumns);
        if (key !== null && seen.has(key)) {
          rowsToRemove.push(physicalRow);
          removedDuplicates++;
          if (affectedRows.length < 20) affectedRows.push(physicalRow - startRow + 1);
        } else if (key !== null) seen.add(key);
      }
      if (options.requiredColumns.some((column) => isEmptyCell(outputValues[column]))) {
        missingRequiredRows++;
        if (missingRequiredRowNumbers.length < 20) missingRequiredRowNumbers.push(physicalRow - startRow + 1);
      }
    }
    const planId = `clean-${this.nextPlanId++}`;
    const preview: SpreadsheetCleanPreview = {
      planId,
      documentId,
      sheetId,
      version: document.version,
      trimmedCells,
      removedEmptyRows,
      removedDuplicates,
      missingRequiredRows,
      missingRequiredRowNumbers,
      affectedRows: [...new Set(affectedRows)],
    };
    this.cleanPlans.set(planId, { id: planId, documentId, sheetId, version: document.version, options, rowsToRemove, preview });
    return preview;
  }

  async applyClean(planId: string): Promise<SpreadsheetDocumentSummary> {
    const plan = this.cleanPlans.get(planId);
    if (!plan) throw new SpreadsheetEngineError("cleanPlanExpired", "This preview has expired. Run the preview again before applying changes.");
    const source = this.requireEditable(plan.documentId);
    this.requireSheet(source, plan.sheetId);
    if (source.version !== plan.version) throw new SpreadsheetEngineError("staleCleanPreview", "The data changed after this preview. Review a new preview before applying it.");
    let workbook: ExcelJS.Workbook | undefined;
    let sheets: Map<string, InternalSheet>;
    if (source.format === "xlsx") {
      const snapshot = await source.workbook!.xlsx.writeBuffer();
      workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(snapshot);
      sheets = workbookSummary(workbook, this.nextDocumentId).sheets;
    } else {
      sheets = new Map([...source.sheets.values()].map((sheet) => [sheet.id, { ...sheet, csvRows: sheet.csvRows?.map((row) => [...row]) }]));
    }
    const sheet = sheets.get(plan.sheetId);
    if (!sheet) throw new SpreadsheetEngineError("sheetMissing", "The selected worksheet is no longer available.");
    if (sheet.csvRows) {
      const remove = new Set(plan.rowsToRemove.map((row) => row - 1));
      const kept: TableRows = [];
      for (let index = 0; index < sheet.csvRows.length; index++) {
        if (remove.has(index)) continue;
        const row = sheet.csvRows[index] ?? [];
        if (plan.options.trimCells) for (let column = 0; column < row.length; column++) {
          const value = row[column];
          if (typeof value === "string") row[column] = value.trim();
        }
        kept.push(row);
      }
      sheet.csvRows = kept;
      sheet.rowCount = kept.length;
      sheet.columnCount = kept.reduce((max, row) => Math.max(max, row.length), 0);
    } else {
      const worksheet = sheet.worksheet!;
      if (plan.options.trimCells) {
        worksheet.eachRow({ includeEmpty: false }, (row) => row.eachCell({ includeEmpty: false }, (cell) => {
          if (typeof cell.value === "string") cell.value = cell.value.trim();
        }));
      }
      const descending = [...plan.rowsToRemove].sort((a, b) => b - a);
      let cursor = 0;
      while (cursor < descending.length) {
        const end = descending[cursor]!;
        let count = 1;
        while (descending[cursor + count] === end - count) count++;
        worksheet.spliceRows(end - count + 1, count);
        cursor += count;
      }
      if (plan.options.removeEmptyRows) {
        while (worksheet.rowCount > 0) {
          const lastRow = worksheet.getRow(worksheet.rowCount);
          let empty = true;
          lastRow.eachCell({ includeEmpty: false }, (cell) => { if (!isEmptyCell(toTableCell(cell.value))) empty = false; });
          if (!empty) break;
          worksheet.spliceRows(worksheet.rowCount, 1);
        }
      }
      sheet.rowCount = worksheet.rowCount;
      sheet.columnCount = worksheet.columnCount;
    }
    const extension = source.format === "xlsx" ? "xlsx" : "csv";
    const result: InternalDocument = {
      id: `sheetresult-${this.nextDocumentId++}`,
      fileName: `${source.fileName.replace(/\.[^.]+$/u, "")}-cleaned.${extension}`,
      format: source.format,
      fileSize: source.fileSize,
      hasHeader: source.hasHeader,
      delimiter: source.delimiter,
      encoding: source.encoding,
      activeSheetId: plan.sheetId,
      sheets,
      workbook,
      formulaCount: source.formulaCount,
      blockers: [...source.blockers],
      version: 0,
      modified: true,
      isResult: true,
      resultConfirmed: false,
      sourceVersions: [{ documentId: source.id, version: source.version }],
    };
    this.documents.set(result.id, result);
    this.cleanPlans.delete(planId);
    return summary(result);
  }

  combine(options: SpreadsheetCombineRequest): SpreadsheetCombinePreview {
    const leftDocument = this.requireEditable(options.leftDocumentId);
    const rightDocument = this.requireEditable(options.rightDocumentId);
    if (leftDocument.formulaCount > 0 || rightDocument.formulaCount > 0) {
      throw new SpreadsheetEngineError("formulaPreventsCombine", "Formula cells are present. Cross-workbook operations are disabled to prevent broken formula references.");
    }
    const leftSheet = this.requireSheet(leftDocument, options.leftSheetId);
    const rightSheet = this.requireSheet(rightDocument, options.rightSheetId);
    if (leftSheet.hidden || rightSheet.hidden) throw new SpreadsheetEngineError("hiddenSheet", "Hidden worksheets cannot be used in multi-table operations.");
    const leftRows = rowsForSheet(leftDocument, leftSheet);
    const rightRows = rowsForSheet(rightDocument, rightSheet);
    let resultRows: TableRows = [];
    let matchedRows: number | undefined;
    let unmatchedRows: number | undefined;
    let diffCounts: Pick<SpreadsheetCombinePreview, "addedRows" | "removedRows" | "changedRows"> = {};
    let conflicts: SpreadsheetCombinePreview["conflicts"] = [];

    if (options.mode === "append") {
      resultRows = appendTables(leftRows, rightRows, options.hasHeader);
    } else if (options.mode === "join") {
      const joined = joinTables(leftRows, rightRows, options.leftKeyColumns, options.rightKeyColumns, options.hasHeader);
      if (!joined.ok) conflicts = joined.conflicts;
      else { resultRows = joined.rows; matchedRows = joined.matchedRows; unmatchedRows = joined.unmatchedRows; }
    } else {
      const diff = compareTables(leftRows, rightRows, options.leftKeyColumns, options.rightKeyColumns, options.hasHeader, MAX_ROWS - 1);
      conflicts = diff.conflicts;
      diffCounts = { addedRows: diff.addedRows, removedRows: diff.removedRows, changedRows: diff.changedRows };
      if (diff.addedRows + diff.removedRows + diff.changedRows > MAX_ROWS - 1) {
        throw new SpreadsheetEngineError("resultTooLarge", "The comparison has more differences than can be reviewed in one result. Narrow the input tables and try again.");
      }
      if (conflicts.length === 0) {
        const leftKeys = new Map<string, TableCell[]>();
        const rightKeys = new Map<string, TableCell[]>();
        const leftStart = options.hasHeader ? 1 : 0;
        const rightStart = options.hasHeader ? 1 : 0;
        for (const row of leftRows.slice(leftStart)) { const key = tableKey(row, options.leftKeyColumns); if (key !== null) leftKeys.set(key, row); }
        for (const row of rightRows.slice(rightStart)) { const key = tableKey(row, options.rightKeyColumns); if (key !== null) rightKeys.set(key, row); }
        resultRows = [["Change", "Key", "Before", "After"]];
        for (const sample of diff.samples) {
          let before = leftKeys.get(sample.key) ?? null;
          let after = rightKeys.get(sample.key) ?? null;
          if (sample.key === "(blank key)") {
            if (sample.kind === "removed") before = leftRows[leftStart + sample.row - 1] ?? null;
            if (sample.kind === "added") after = rightRows[rightStart + sample.row - 1] ?? null;
          }
          const displayKey = sample.key === "(blank key)"
            ? `(blank key; row ${sample.row})`
            : (options.leftKeyColumns.map((column) => String(before?.[column] ?? "")).join(" / ") || options.rightKeyColumns.map((column) => String(after?.[column] ?? "")).join(" / "));
          resultRows.push([sample.kind, displayKey, JSON.stringify(before), JSON.stringify(after)]);
        }
        if (resultRows.length === 1) resultRows.push(["No changes", "", "", ""]);
      }
    }
    const columns = Math.max(0, ...resultRows.slice(0, 50).map((row) => row.length));
    const cells = estimateCells(resultRows);
    if (conflicts.length === 0 && (resultRows.length > MAX_ROWS || cells > MAX_RESULT_CELLS)) {
      throw new SpreadsheetEngineError("resultTooLarge", "This operation would create too many output rows or cells.");
    }
    let resultSummary: SpreadsheetDocumentSummary | undefined;
    if (conflicts.length === 0) {
      const id = `sheetresult-${this.nextDocumentId++}`;
      const useXlsx = leftDocument.format === "xlsx" || rightDocument.format === "xlsx";
      const resultSheet: InternalSheet = {
        id: "result-sheet-1",
        name: "Result",
        csvRows: resultRows,
        rowCount: resultRows.length,
        columnCount: columns,
        hidden: false,
        formulaCount: 0,
        mergedCellCount: 0,
      };
      const resultDocument: InternalDocument = {
        id,
        fileName: options.mode === "compare" ? "yoyo-table-differences" : "yoyo-table-result",
        format: useXlsx ? "xlsx" : "csv",
        fileSize: 0,
        hasHeader: true,
        delimiter: ",",
        encoding: "utf-8",
        activeSheetId: resultSheet.id,
        sheets: new Map([[resultSheet.id, resultSheet]]),
        formulaCount: 0,
        blockers: [],
        version: 0,
        modified: true,
        isResult: true,
        resultConfirmed: false,
        sourceVersions: [
          { documentId: leftDocument.id, version: leftDocument.version },
          ...(rightDocument.id === leftDocument.id ? [] : [{ documentId: rightDocument.id, version: rightDocument.version }]),
        ],
      };
      this.documents.set(id, resultDocument);
      resultSummary = summary(resultDocument);
    }
    return {
      result: resultSummary,
      mode: options.mode,
      rowCount: Math.max(0, resultRows.length - (options.hasHeader ? 1 : 0)),
      columnCount: columns,
      matchedRows,
      unmatchedRows,
      ...diffCounts,
      conflicts,
    };
  }

  confirmResult(documentId: string): SpreadsheetDocumentSummary {
    const document = this.requireDocument(documentId);
    if (!document.isResult) throw new SpreadsheetEngineError("notAResult", "Only generated results can be confirmed.");
    if (!this.isResultCurrent(document)) throw new SpreadsheetEngineError("staleResult", "A source table changed after this result was created. Run the operation again before downloading.");
    document.resultConfirmed = true;
    document.version++;
    return summary(document);
  }

  async export(documentId: string, sheetId: string, format: SpreadsheetFormat): Promise<{ fileName: string; mimeType: string; buffer: ArrayBuffer }> {
    const document = this.requireDocument(documentId);
    const sheet = this.requireSheet(document, sheetId);
    if (!document.isResult && document.blockers.length > 0) {
      throw new SpreadsheetEngineError("unsafeWorkbookExport", "This workbook contains features that cannot be guaranteed to survive export. Downloading it from this workspace is disabled.");
    }
    if (document.isResult && !document.resultConfirmed) {
      throw new SpreadsheetEngineError("resultNotConfirmed", "Review and confirm the generated result before downloading it.");
    }
    if (document.isResult && !this.isResultCurrent(document)) {
      document.resultConfirmed = false;
      throw new SpreadsheetEngineError("staleResult", "A source table changed after this result was created. Run the operation again before downloading.");
    }
    if (document.format === "xlsx" && !document.isResult && format !== "xlsx") {
      throw new SpreadsheetEngineError("unsafeFormatConversion", "An imported XLSX workbook must be exported as XLSX to preserve its formulas and formatting.");
    }
    if (format === "csv") {
      const rows = rowsForSheet(document, sheet);
      const text = stringifyCsv(rows, document.delimiter || ",");
      const buffer = new TextEncoder().encode(text).buffer;
      return { fileName: `${safeWorksheetName(document.fileName.replace(/\.[^.]+$/u, ""))}.csv`, mimeType: "text/csv;charset=utf-8", buffer };
    }
    let binary: ArrayBuffer | Uint8Array;
    if (document.workbook) {
      binary = await document.workbook.xlsx.writeBuffer();
    } else {
      const rows = rowsForSheet(document, sheet);
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet(safeWorksheetName(sheet.name));
      for (const row of rows) worksheet.addRow(row);
      workbook.calcProperties.fullCalcOnLoad = true;
      binary = await workbook.xlsx.writeBuffer();
    }
    return {
      fileName: `${safeWorksheetName(document.fileName.replace(/\.[^.]+$/u, ""))}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: asTransferableBuffer(binary),
    };
  }

  private recordHistory(document: InternalDocument, command: HistoryCommand): void {
    document.undoStack ??= [];
    document.redoStack = [];
    document.undoStack.push(command);
    if (document.undoStack.length > MAX_HISTORY_COMMANDS) document.undoStack.shift();
  }

  private applyColumnMove(sheet: InternalSheet, from: number, to: number): void {
    if (!sheet.csvRows) throw new SpreadsheetEngineError("xlsxStructureBlocked", "Column reordering is currently supported for CSV tables only.");
    for (const row of sheet.csvRows) {
      const values = Array.from({ length: sheet.columnCount }, (_, index) => row[index]);
      const [moved] = values.splice(from, 1);
      values.splice(to, 0, moved);
      while (values.length > 0 && values.at(-1) === undefined) values.pop();
      row.splice(0, row.length, ...values as TableCell[]);
    }
  }

  private writeCellValue(document: InternalDocument, sheet: InternalSheet, row: number, column: number, value: HistoryValue): void {
    const physicalRow = row + (document.hasHeader ? 2 : 1);
    if (sheet.csvRows) {
      const target = sheet.csvRows[physicalRow - 1];
      if (!target) throw new SpreadsheetEngineError("cellOutOfBounds", "The target row no longer exists.");
      if (value === undefined) delete target[column];
      else target[column] = value as TableCell;
      return;
    }
    sheet.worksheet!.getCell(physicalRow, column + 1).value = value as CellValue;
  }

  private applyStructure(
    document: InternalDocument,
    sheet: InternalSheet,
    axis: "row" | "column",
    operation: "insert" | "delete",
    index: number,
    restoreValues?: HistoryValue[],
    restoreLengths?: number[],
  ): { removedValues?: HistoryValue[]; beforeLengths?: number[] } {
    if (!sheet.csvRows) throw new SpreadsheetEngineError("xlsxStructureBlocked", "Structural edits are currently supported for CSV tables only.");
    const count = axis === "row" ? dataRowCount(document, sheet) : sheet.columnCount;
    const valid = operation === "insert" ? Number.isInteger(index) && index >= 0 && index <= count : Number.isInteger(index) && index >= 0 && index < count;
    if (!valid) throw new SpreadsheetEngineError("structurePositionInvalid", "Choose a position inside the table. No cells were changed.");
    const nextRowCount = sheet.rowCount + (axis === "row" ? (operation === "insert" ? 1 : -1) : 0);
    const nextColumnCount = sheet.columnCount + (axis === "column" ? (operation === "insert" ? 1 : -1) : 0);
    // Validate before mutating so a rejected change cannot leave a half-edited table behind.
    validateDimensions(nextRowCount, nextColumnCount, document.fileName);

    let removedValues: HistoryValue[] | undefined;
    let beforeLengths: number[] | undefined;
    const headerOffset = document.hasHeader ? 1 : 0;
    if (axis === "row") {
      const physicalIndex = index + headerOffset;
      if (operation === "delete") {
        const removedRow = sheet.csvRows[physicalIndex] ?? [];
        removedValues = [...removedRow];
        beforeLengths = [removedRow.length];
        sheet.csvRows.splice(physicalIndex, 1);
      } else {
        const restoredRow = restoreValues ? [...restoreValues] as TableCell[] : Array<TableCell>(sheet.columnCount).fill(null);
        if (restoreLengths?.[0] !== undefined) restoredRow.length = restoreLengths[0];
        sheet.csvRows.splice(physicalIndex, 0, restoredRow);
      }
      sheet.rowCount = sheet.csvRows.length;
      sheet.columnCount = sheet.csvRows.reduce((max, row) => Math.max(max, row.length), 0);
    } else {
      if (operation === "delete") {
        beforeLengths = sheet.csvRows.map((row) => row.length);
        removedValues = sheet.csvRows.map((row) => row[index]);
        for (const row of sheet.csvRows) if (index < row.length) row.splice(index, 1);
      } else {
        for (const [rowIndex, row] of sheet.csvRows.entries()) {
          if (restoreLengths && (restoreLengths[rowIndex] ?? 0) <= index) continue;
          if (index <= row.length) row.splice(index, 0, restoreValues?.[rowIndex] as TableCell ?? null);
        }
      }
      sheet.columnCount = sheet.csvRows.reduce((max, row) => Math.max(max, row.length), 0);
    }
    validateDimensions(sheet.rowCount, sheet.columnCount, document.fileName);
    return operation === "delete" ? { removedValues, beforeLengths } : {};
  }

  private applyHistoryCommand(document: InternalDocument, command: HistoryCommand, direction: "undo" | "redo"): void {
    if (command.kind === "header") {
      document.hasHeader = direction === "undo" ? command.before : command.after;
      return;
    }
    const sheet = this.requireSheet(document, command.sheetId);
    if (command.kind === "cells") {
      for (const change of command.changes) this.writeCellValue(document, sheet, change.row, change.column, direction === "undo" ? change.before : change.after);
      return;
    }
    if (command.kind === "columnHeader") {
      const header = sheet.csvRows?.[0];
      if (!header) throw new SpreadsheetEngineError("headerRequired", "This table does not have a header row.");
      const value = direction === "undo" ? command.before : command.after;
      if (value === undefined) delete header[command.column];
      else header[command.column] = value as TableCell;
      return;
    }
    if (command.kind === "columnMove") {
      this.applyColumnMove(sheet, direction === "undo" ? command.to : command.from, direction === "undo" ? command.from : command.to);
      return;
    }
    if (direction === "undo") {
      const inverse = command.operation === "insert" ? "delete" : "insert";
      this.applyStructure(document, sheet, command.axis, inverse, command.index, command.removedValues, command.beforeLengths);
      return;
    }
    this.applyStructure(document, sheet, command.axis, command.operation, command.index, command.removedValues, command.beforeLengths);
  }

  private requireDocument(id: string): InternalDocument {
    const document = this.documents.get(id);
    if (!document) throw new SpreadsheetEngineError("documentMissing", "This file is no longer available in the current session. Import it again to continue.");
    return document;
  }

  private requireEditable(id: string): InternalDocument {
    const document = this.requireDocument(id);
    if (document.blockers.length > 0) throw new SpreadsheetEngineError("unsafeWorkbookEdit", document.blockers.join(" "));
    return document;
  }

  private isResultCurrent(document: InternalDocument): boolean {
    return (document.sourceVersions ?? []).every(({ documentId, version }) => this.documents.get(documentId)?.version === version);
  }

  private requireSheet(document: InternalDocument, id: string): InternalSheet {
    const sheet = document.sheets.get(id);
    if (!sheet) throw new SpreadsheetEngineError("sheetMissing", "The selected worksheet is no longer available.");
    return sheet;
  }
}
