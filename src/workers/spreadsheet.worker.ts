import { SpreadsheetEngine, SpreadsheetEngineError } from "../lib/spreadsheet-engine";
import type { SpreadsheetWorkerRequest, SpreadsheetWorkerResponse } from "../lib/spreadsheet-types";

const engine = new SpreadsheetEngine();
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SpreadsheetWorkerRequest>) => void) | null;
  postMessage: (message: SpreadsheetWorkerResponse, transfer?: Transferable[]) => void;
};

function send(message: SpreadsheetWorkerResponse) {
  scope.postMessage(message);
}

scope.onmessage = async (event) => {
  const request = event.data;
  try {
    switch (request.type) {
      case "warm":
        send({ type: "ready", requestId: request.requestId });
        break;
      case "load": {
        try {
          const documents = await engine.importFiles(request.files, request.options, (fileName, progress) => {
            send({ type: "progress", requestId: request.requestId, fileName, progress });
          });
          send({ type: "loaded", requestId: request.requestId, documents });
        } catch (error) {
          engine.reset();
          throw error;
        }
        break;
      }
      case "getRows":
        send({
          type: "rows",
          requestId: request.requestId,
          documentId: request.documentId,
          sheetId: request.sheetId,
          start: request.start,
          rows: engine.getRows(request.documentId, request.sheetId, request.start, request.count, request.includeStyles),
        });
        break;
      case "setHeader":
      case "setSheet":
        send({ type: "updated", requestId: request.requestId, document: request.type === "setHeader"
          ? engine.setHeader(request.documentId, request.hasHeader)
          : engine.setSheet(request.documentId, request.sheetId) });
        break;
      case "editCells":
        send({ type: "updated", requestId: request.requestId, document: engine.editCells(request.documentId, request.sheetId, request.patches) });
        break;
      case "structure":
        send({ type: "updated", requestId: request.requestId, document: engine.editStructure(request.documentId, request.sheetId, request.axis, request.operation, request.index) });
        break;
      case "renameColumn":
        send({ type: "updated", requestId: request.requestId, document: engine.renameColumn(request.documentId, request.sheetId, request.column, request.name) });
        break;
      case "moveColumn":
        send({ type: "updated", requestId: request.requestId, document: engine.moveColumn(request.documentId, request.sheetId, request.from, request.to) });
        break;
      case "undo":
        send({ type: "updated", requestId: request.requestId, document: engine.undo(request.documentId) });
        break;
      case "redo":
        send({ type: "updated", requestId: request.requestId, document: engine.redo(request.documentId) });
        break;
      case "previewClean":
        send({ type: "cleanPreview", requestId: request.requestId, preview: engine.previewClean(request.documentId, request.sheetId, request.options) });
        break;
      case "applyClean":
        send({ type: "cleanApplied", requestId: request.requestId, document: await engine.applyClean(request.planId) });
        break;
      case "combine":
        send({ type: "combinePreview", requestId: request.requestId, preview: engine.combine(request.options) });
        break;
      case "confirmResult":
        send({ type: "resultConfirmed", requestId: request.requestId, document: engine.confirmResult(request.documentId) });
        break;
      case "export": {
        const result = await engine.export(request.documentId, request.sheetId, request.format);
        const response: SpreadsheetWorkerResponse = { type: "exported", requestId: request.requestId, ...result };
        scope.postMessage(response, [result.buffer]);
        break;
      }
    }
  } catch (error) {
    const known = error instanceof SpreadsheetEngineError;
    send({
      type: "error",
      requestId: request.requestId,
      code: known ? error.code : "processingFailed",
      message: known ? error.message : "The spreadsheet could not be processed. Check the file and try again.",
    });
  }
};
