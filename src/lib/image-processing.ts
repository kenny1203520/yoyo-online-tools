export type OutputFormat = "same" | "image/jpeg" | "image/png" | "image/webp";

export type ImageSettings = {
  format: OutputFormat;
  quality: number;
  maxWidth: number | null;
  maxHeight: number | null;
};

export type ImageResult = {
  blob: Blob;
  mime: string;
  width: number;
  height: number;
  size: number;
  settingsKey: string;
};

export type ImageEntry = {
  id: string;
  file: File;
  previewUrl: string;
  mime: "image/jpeg" | "image/png" | "image/webp";
  width: number;
  height: number;
  overrides: Partial<ImageSettings>;
  status: "ready" | "queued" | "processing" | "done" | "error";
  error?: string;
  result?: ImageResult;
};

export const MAX_FILES = 20;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PIXELS = 24_000_000;

function ascii(data: Uint8Array, start: number, end: number) {
  let value = "";
  for (let index = start; index < end; index += 1) value += String.fromCharCode(data[index]);
  return value;
}

function sniffImage(data: Uint8Array): ImageEntry["mime"] | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  if (data.length >= 8 && data[0] === 0x89 && ascii(data, 1, 4) === "PNG" && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a) return "image/png";
  if (data.length >= 12 && ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 12) === "WEBP") return "image/webp";
  return null;
}

function isAnimated(data: Uint8Array, mime: ImageEntry["mime"]) {
  if (mime === "image/webp") {
    // VP8X animation flag, when present, is the second feature bit.
    return data.length >= 21 && ascii(data, 12, 16) === "VP8X" && (data[20] & 0x02) !== 0;
  }
  if (mime === "image/png") {
    // APNG's animation control chunk appears before image data.
    for (let i = 8; i + 8 <= data.length;) {
      const size = (data[i] * 0x1000000) + (data[i + 1] << 16) + (data[i + 2] << 8) + data[i + 3];
      if (ascii(data, i + 4, i + 8) === "acTL") return true;
      if (!Number.isSafeInteger(size) || size < 0 || i + 12 + size <= i || i + 12 + size > data.length) break;
      i += 12 + size;
    }
  }
  return false;
}

export async function inspectImage(file: File): Promise<{ mime: ImageEntry["mime"]; width: number; height: number }> {
  if (file.size > MAX_FILE_BYTES) throw new Error("單張圖片超過 20 MB。請先縮小圖片，再試一次。");
  if (!file.size) throw new Error("這個檔案是空的，請選擇其他圖片。");

  const header = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const mime = sniffImage(header);
  if (!mime) throw new Error("目前支援靜態 JPG、PNG 和 WebP。這個檔案格式無法使用。");
  if (isAnimated(header, mime)) throw new Error("目前只支援靜態圖片。請轉成單張圖片後再試一次。");

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) throw new Error("讀取不到圖片尺寸，請選擇其他圖片。");
    if (width * height > MAX_PIXELS) throw new Error("圖片超過 2,400 萬像素。請先縮小圖片，再試一次。");
    return { mime, width, height };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("圖片超過")) throw error;
    throw new Error("無法讀取這張圖片。請確認檔案完整後再試一次。");
  } finally {
    bitmap?.close();
  }
}

export function effectiveSettings(base: ImageSettings, overrides: Partial<ImageSettings>): ImageSettings {
  return { ...base, ...overrides };
}

export function settingsKey(settings: ImageSettings, mime: ImageEntry["mime"]) {
  const outputMime = settings.format === "same" ? mime : settings.format;
  return JSON.stringify({ ...settings, outputMime });
}

export function actualOutputFormat(settings: ImageSettings, inputMime: ImageEntry["mime"]) {
  return settings.format === "same" ? inputMime : settings.format;
}

export async function supportsOutputFormat(mime: ImageEntry["mime"]) {
  if (typeof document === "undefined") return false;
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, 0.8));
  return blob?.type === mime;
}

export async function processImage(entry: ImageEntry, settings: ImageSettings): Promise<ImageResult> {
  const targetMime = actualOutputFormat(settings, entry.mime);
  if (!(await supportsOutputFormat(targetMime))) throw new Error(`${formatLabel(targetMime)} 輸出不受目前瀏覽器支援。請換一種格式，或改用其他瀏覽器。`);

  let bitmap: ImageBitmap | undefined;
  try {
    bitmap = await createImageBitmap(entry.file, { imageOrientation: "from-image" });
    const originalWidth = bitmap.width;
    const originalHeight = bitmap.height;
    const maxWidth = settings.maxWidth || originalWidth;
    const maxHeight = settings.maxHeight || originalHeight;
    const scale = Math.min(1, maxWidth / originalWidth, maxHeight / originalHeight);
    const width = Math.max(1, Math.round(originalWidth * scale));
    const height = Math.max(1, Math.round(originalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: targetMime !== "image/jpeg" });
    if (!context) throw new Error("瀏覽器暫時無法處理圖片。請關閉其他分頁後再試一次。");
    if (targetMime === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, targetMime, targetMime === "image/png" ? undefined : settings.quality));
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error("圖片輸出失敗。請降低圖片尺寸後重試。");
    if (blob.type !== targetMime) throw new Error(`${formatLabel(targetMime)} 輸出不受目前瀏覽器支援。請換一種格式，或改用其他瀏覽器。`);
    return { blob, mime: blob.type, width, height, size: blob.size, settingsKey: settingsKey(settings, entry.mime) };
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("圖片處理失敗。請再試一次。");
  } finally {
    bitmap?.close();
  }
}

export function formatLabel(mime: string) {
  if (mime === "image/jpeg") return "JPG";
  if (mime === "image/png") return "PNG";
  if (mime === "image/webp") return "WebP";
  return "圖片";
}

export function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function safeFileName(value: string) {
  return value.split(/[\\/]/).pop()?.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").trim() || "image";
}

export function fileExtension(mime: string) {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  return "webp";
}
