import { message, type MessageKey, type MessageRef } from "./messages";
export class ProcessingError extends Error {
  constructor(public readonly code: MessageKey, public readonly values?: MessageRef["values"]) {
    super(code); this.name = "ProcessingError";
  }
}
export function processingIssue(error: unknown): MessageRef {
  return error instanceof ProcessingError ? { key: error.code, values: error.values } : message("processingFailed");
}
