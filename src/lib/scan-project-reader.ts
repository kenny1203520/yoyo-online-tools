import type { ScanProjectFrame, ScanProjectIndex } from "./scan-project";

export type ScanOpenResult = { project: ScanProjectIndex | null; models: string[]; entryNames: string[]; imageCount: number; otherCount: number };
export type ScanImage = { width: number; height: number; rgba: Uint8ClampedArray };
export type ScanPreview = {
  photo?: { name: string; bytes: Uint8Array; orientation: number; width?: number; height?: number };
  depth?: { width: number; height: number; raw: Uint16Array; rgba: Uint8ClampedArray; minimum: number; maximum: number } | { error: string };
  confidence?: { width: number; height: number; values: Uint8Array; rgba: Uint8ClampedArray } | { error: string };
};

type WorkerReply = { id: number; type: "progress"; value: { phase: string; progress: number; message: string } }
  | { id: number; type: "result"; value: ScanOpenResult }
  | { id: number; type: "files"; value: Array<{ name: string; bytes: Uint8Array }> }
  | { id: number; type: "preview"; value: ScanPreview }
  | { id: number; type: "error"; value: string };
type Progress = { phase: string; progress: number; message: string };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; onProgress?: (value: Progress) => void };

export class ScanProjectReader {
  private worker: Worker;
  private nextId = 0;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("../workers/scan-project.worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerReply>) => {
      const reply = event.data;
      const pending = this.pending.get(reply.id);
      if (!pending) return;
      if (reply.type === "progress") { pending.onProgress?.(reply.value); return; }
      this.pending.delete(reply.id);
      if (reply.type === "error") pending.reject(new Error(reply.value));
      else pending.resolve(reply.value);
    };
    this.worker.onerror = () => this.failAll(new Error("The scan reader worker failed."));
  }

  open(file: File, onProgress?: (value: Progress) => void) {
    return this.request<ScanOpenResult>({ type: "open", file }, onProgress);
  }

  read(names: string[]) {
    return this.request<Array<{ name: string; bytes: Uint8Array }>>({ type: "read", names });
  }

  loadPreview(frame: ScanProjectFrame) {
    return this.request<ScanPreview>({ type: "preview", frame });
  }

  close() {
    this.failAll(new DOMException("Scan reading cancelled", "AbortError"));
    this.worker.terminate();
  }

  private request<T>(data: Record<string, unknown>, onProgress?: (value: Progress) => void): Promise<T> {
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, onProgress });
      this.worker.postMessage({ ...data, id });
    });
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
