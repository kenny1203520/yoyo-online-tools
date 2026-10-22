import { getTextStats, transformText, type TextCleanupOptions } from "../lib/text-processing";
const scope = self as unknown as { onmessage: ((event: MessageEvent<{ requestId: number; source: string; options: TextCleanupOptions }>) => void) | null; postMessage: (reply: unknown) => void };
scope.onmessage = (event) => {
  const { source, options, requestId } = event.data;
  try {
    const transformed = transformText(source, options);
    scope.postMessage({ requestId, result: { source, output: transformed.value, sourceStats: getTextStats(source), outputStats: getTextStats(transformed.value), removedDuplicateLines: transformed.removedDuplicateLines } });
  } catch { scope.postMessage({ requestId, error: true }); }
};
scope.postMessage({ ready: true });
