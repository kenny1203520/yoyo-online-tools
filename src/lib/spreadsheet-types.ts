import type { TableCell } from "./spreadsheet-processing";

export type SpreadsheetFormat = "csv" | "xlsx";
export type SpreadsheetEncoding = "utf-8" | "big5" | "shift_jis" | "windows-1252";

export type SpreadsheetCellStyle = {
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  horizontal?: "left" | "center" | "right";
  vertical?: "top" | "middle" | "bottom";
  wrapText?: boolean;
  numberFormat?: string;
  borderTop?: string;
  borderRight?: string;
  borderBottom?: string;
  borderLeft?: string;
};

export type SpreadsheetGridRow = {
  __rowIndex: number;
  __cellStyles?: Array<SpreadsheetCellStyle | undefined>;
  [column: string]: unknown;
};

export type SpreadsheetSheetSummary = {
  id: string;
  name: string;
  rowCount: number;
  dataRowCount: number;
  columnCount: number;
  headers: string[];
  hidden: boolean;
  formulaCount: number;
  mergedCellCount: number;
};

export type SpreadsheetDocumentSummary = {
  id: string;
  fileName: string;
  format: SpreadsheetFormat;
  fileSize: number;
  hasHeader: boolean;
  delimiter: string;
  encoding: SpreadsheetEncoding;
  activeSheetId: string;
  sheets: SpreadsheetSheetSummary[];
  formulaCount: number;
  blockers: string[];
  version: number;
  modified: boolean;
  isResult: boolean;
  resultConfirmed: boolean;
  sourceVersions?: Array<{ documentId: string; version: number }>;
  canUndo: boolean;
  canRedo: boolean;
  supportsStructure: boolean;
};

export type SpreadsheetImportOptions = {
  hasHeader: boolean;
  delimiter: string;
  encoding: SpreadsheetEncoding;
};

export type SpreadsheetCellPatch = {
  row: number;
  column: number;
  value: string;
};

export type SpreadsheetCleanOptions = {
  trimCells: boolean;
  removeEmptyRows: boolean;
  deduplicate: boolean;
  keyColumns: number[];
  requiredColumns: number[];
};

export type SpreadsheetCleanPreview = {
  planId: string;
  documentId: string;
  sheetId: string;
  version: number;
  trimmedCells: number;
  removedEmptyRows: number;
  removedDuplicates: number;
  missingRequiredRows: number;
  missingRequiredRowNumbers: number[];
  affectedRows: number[];
};

export type SpreadsheetCombineMode = "append" | "join" | "compare";

export type SpreadsheetCombineRequest = {
  mode: SpreadsheetCombineMode;
  leftDocumentId: string;
  leftSheetId: string;
  rightDocumentId: string;
  rightSheetId: string;
  hasHeader: boolean;
  leftKeyColumns: number[];
  rightKeyColumns: number[];
};

export type SpreadsheetCombinePreview = {
  result?: SpreadsheetDocumentSummary;
  mode: SpreadsheetCombineMode;
  rowCount: number;
  columnCount: number;
  matchedRows?: number;
  unmatchedRows?: number;
  addedRows?: number;
  removedRows?: number;
  changedRows?: number;
  conflicts: Array<{ key: string; rows: number[] }>;
};

export type SpreadsheetWorkerRequest =
  | { type: "warm"; requestId: number }
  | { type: "load"; requestId: number; files: File[]; options: SpreadsheetImportOptions }
  | { type: "getRows"; requestId: number; documentId: string; sheetId: string; start: number; count: number; includeStyles: boolean }
  | { type: "setHeader"; requestId: number; documentId: string; hasHeader: boolean }
  | { type: "setSheet"; requestId: number; documentId: string; sheetId: string }
  | { type: "editCells"; requestId: number; documentId: string; sheetId: string; patches: SpreadsheetCellPatch[] }
  | { type: "structure"; requestId: number; documentId: string; sheetId: string; axis: "row" | "column"; operation: "insert" | "delete"; index: number }
  | { type: "renameColumn"; requestId: number; documentId: string; sheetId: string; column: number; name: string }
  | { type: "moveColumn"; requestId: number; documentId: string; sheetId: string; from: number; to: number }
  | { type: "undo"; requestId: number; documentId: string }
  | { type: "redo"; requestId: number; documentId: string }
  | { type: "previewClean"; requestId: number; documentId: string; sheetId: string; options: SpreadsheetCleanOptions }
  | { type: "applyClean"; requestId: number; planId: string }
  | { type: "combine"; requestId: number; options: SpreadsheetCombineRequest }
  | { type: "confirmResult"; requestId: number; documentId: string }
  | { type: "export"; requestId: number; documentId: string; sheetId: string; format: SpreadsheetFormat };

export type SpreadsheetWorkerResponse =
  | { type: "ready"; requestId: number }
  | { type: "progress"; requestId: number; fileName: string; progress: number }
  | { type: "loaded"; requestId: number; documents: SpreadsheetDocumentSummary[] }
  | { type: "rows"; requestId: number; documentId: string; sheetId: string; start: number; rows: SpreadsheetGridRow[] }
  | { type: "updated"; requestId: number; document: SpreadsheetDocumentSummary }
  | { type: "cleanPreview"; requestId: number; preview: SpreadsheetCleanPreview }
  | { type: "cleanApplied"; requestId: number; document: SpreadsheetDocumentSummary }
  | { type: "combinePreview"; requestId: number; preview: SpreadsheetCombinePreview }
  | { type: "resultConfirmed"; requestId: number; document: SpreadsheetDocumentSummary }
  | { type: "exported"; requestId: number; fileName: string; mimeType: string; buffer: ArrayBuffer }
  | { type: "error"; requestId: number; code: string; message: string };
