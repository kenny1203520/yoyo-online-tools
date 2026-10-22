import { defaultLocale, getLocalizedText, type Locale, type LocalizedText } from "@/lib/i18n";

export { type Locale, type LocalizedText } from "@/lib/i18n";
export type LocalizedTerms = Record<Locale, string[]>;

type ToolBase = {
  slug: string;
  name: LocalizedText;
  shortName: LocalizedText;
  description: LocalizedText;
  searchTerms: LocalizedTerms;
  href: string;
  category: "image" | "text" | "developer" | "3d";
  processing: "local";
};

export type ImageTool = ToolBase & {
  category: "image";
  workspace: "image";
  icon: "compress" | "resize" | "convert";
  format: "image-compress" | "image-resize" | "image-convert";
  verb: LocalizedText;
};

export type TextMode = "cleanup" | "duplicates" | "count";

export type TextTool = ToolBase & {
  category: "text";
  workspace: "text";
  icon: "cleanup" | "duplicates" | "count";
  textMode: TextMode;
};

export type DeveloperTool = ToolBase & {
  category: "developer";
  workspace: "developer";
  icon: "code" | "diff" | "binary" | "link" | "clock" | "regex";
  developerMode: "json" | "diff" | "base64" | "url" | "timestamp" | "regex";
};

export type ThreeTool = ToolBase & {
  category: "3d";
  workspace: "3d";
  icon: "box";
};

export type Tool = ImageTool | TextTool | DeveloperTool | ThreeTool;

export const tools: Tool[] = [
  {
    slug: "image-compress", category: "image", workspace: "image", processing: "local",
    name: { "zh-TW": "圖片壓縮", en: "Image Compressor" }, shortName: { "zh-TW": "壓縮圖片", en: "Compress images" },
    description: { "zh-TW": "調整 JPG、WebP 畫質，讓圖片更方便傳送。", en: "Reduce JPG and WebP file sizes for easier sharing." },
    searchTerms: { "zh-TW": ["照片太大", "圖片太大", "檔案太大", "變小", "寄信", "減少容量", "最佳化", "壓縮照片"], en: ["images", "photos", "image compression", "compress photo", "compress picture", "photo too large", "photo too big", "image too large", "reduce image size", "shrink image", "optimize image", "smaller file"] },
    href: "/tools/image-compress", icon: "compress", format: "image-compress", verb: { "zh-TW": "調整畫質與大小", en: "Adjust quality and size" },
  },
  {
    slug: "image-resize", category: "image", workspace: "image", processing: "local",
    name: { "zh-TW": "調整圖片尺寸", en: "Resize Images" }, shortName: { "zh-TW": "調整尺寸", en: "Resize" },
    description: { "zh-TW": "輸入圖片寬高，等比例縮放整批圖片。", en: "Resize images proportionally to your chosen width or height." },
    searchTerms: { "zh-TW": ["縮圖", "改尺寸", "寬度", "高度", "圖片大小", "調整照片"], en: ["resize photo", "resize picture", "change image dimensions", "change image width", "change image height", "make thumbnail", "scale image"] },
    href: "/tools/image-resize", icon: "resize", format: "image-resize", verb: { "zh-TW": "調整圖片寬高", en: "Resize image dimensions" },
  },
  {
    slug: "image-convert", category: "image", workspace: "image", processing: "local",
    name: { "zh-TW": "圖片格式轉換", en: "Image Converter" }, shortName: { "zh-TW": "轉換格式", en: "Convert format" },
    description: { "zh-TW": "在 JPG、PNG 和 WebP 之間轉換圖片。", en: "Convert images between JPG, PNG and WebP formats." },
    searchTerms: { "zh-TW": ["改副檔名", "webp", "jpg", "jpeg", "png", "轉檔", "轉格式", "圖片格式"], en: ["convert image", "convert photo", "change image format", "png to jpg", "jpg to png", "jpg to webp", "webp to jpg", "png to webp", "webp to png", "webp converter", "image file type"] },
    href: "/tools/image-convert", icon: "convert", format: "image-convert", verb: { "zh-TW": "選擇輸出格式", en: "Choose an output format" },
  },
  {
    slug: "text-cleanup", category: "text", workspace: "text", processing: "local",
    name: { "zh-TW": "文字清理", en: "Clean Up Text" }, shortName: { "zh-TW": "清理文字", en: "Clean text" },
    description: { "zh-TW": "整理多餘空白行與行尾空格，同時保留段落結構。", en: "Remove extra blank lines and trailing spaces while keeping paragraphs." },
    searchTerms: { "zh-TW": ["整理文字", "清理文字", "複製文字", "空白行", "多餘空格", "網頁文字", "pdf 文字", "貼上文字"], en: ["text cleanup", "clean text", "remove extra spaces", "remove blank lines", "clean copied text", "format pasted text", "clean up whitespace"] },
    href: "/tools/text-cleanup", icon: "cleanup", textMode: "cleanup",
  },
  {
    slug: "remove-duplicate-lines", category: "text", workspace: "text", processing: "local",
    name: { "zh-TW": "移除重複行", en: "Remove Duplicate Lines" }, shortName: { "zh-TW": "移除重複行", en: "Remove duplicates" },
    description: { "zh-TW": "逐行整理清單，保留每個內容第一次出現的順序。", en: "Remove repeated lines while keeping the original order." },
    searchTerms: { "zh-TW": ["去重", "刪除重複", "重複項目", "重複文字", "名單整理", "清理清單"], en: ["remove duplicates", "duplicate lines", "deduplicate text", "unique lines", "clean a list", "remove repeated text"] },
    href: "/tools/remove-duplicate-lines", icon: "duplicates", textMode: "duplicates",
  },
  {
    slug: "word-count", category: "text", workspace: "text", processing: "local",
    name: { "zh-TW": "字數統計", en: "Word and Character Counter" }, shortName: { "zh-TW": "字數統計", en: "Word count" },
    description: { "zh-TW": "查看中文字數、英文單字、字元、行數與檔案大小。", en: "Count Chinese characters, English words, characters, lines and bytes." },
    searchTerms: { "zh-TW": ["文章字數", "字元統計", "計算字數", "文案長度", "字數限制", "中文字數", "單字數"], en: ["word counter", "word count", "character count", "count words", "count characters", "text length", "letter counter"] },
    href: "/tools/word-count", icon: "count", textMode: "count",
  },
  {
    slug: "json-formatter", category: "developer", workspace: "developer", processing: "local", developerMode: "json", icon: "code",
    name: { "zh-TW": "JSON 格式化與驗證", en: "JSON Formatter and Validator" }, shortName: { "zh-TW": "格式化 JSON", en: "Format JSON" },
    description: { "zh-TW": "格式化、壓縮 JSON，並定位語法錯誤。", en: "Format, minify, and validate JSON with error locations." },
    searchTerms: { "zh-TW": ["json 格式化", "json 美化", "json 驗證", "json 錯誤", "json formatter", "pretty print"], en: ["json format", "format json", "json beautifier", "validate json", "json syntax error", "minify json"] }, href: "/tools/json-formatter",
  },
  {
    slug: "text-diff", category: "developer", workspace: "developer", processing: "local", developerMode: "diff", icon: "diff",
    name: { "zh-TW": "文字與 JSON 比對", en: "Text and JSON Diff" }, shortName: { "zh-TW": "比對差異", en: "Compare" },
    description: { "zh-TW": "並排比較文字或 JSON，找出新增、刪除與修改。", en: "Compare text or JSON side by side to find additions, removals, and changes." },
    searchTerms: { "zh-TW": ["比對文字", "文字差異", "json 比較", "compare text", "diff", "compare json"], en: ["text compare", "text difference", "compare files", "json compare", "diff viewer"] }, href: "/tools/text-diff",
  },
  {
    slug: "base64", category: "developer", workspace: "developer", processing: "local", developerMode: "base64", icon: "binary",
    name: { "zh-TW": "Base64 編解碼", en: "Base64 Encoder and Decoder" }, shortName: { "zh-TW": "Base64", en: "Base64" },
    description: { "zh-TW": "將 UTF-8 文字編碼或解碼為 Base64 與 Base64url。", en: "Encode or decode UTF-8 text as Base64 or Base64url." },
    searchTerms: { "zh-TW": ["base64 編碼", "base64 解碼", "base64url", "文字編碼"], en: ["base64 encode", "base64 decode", "base64url", "text encoding"] }, href: "/tools/base64",
  },
  {
    slug: "url-encode-decode", category: "developer", workspace: "developer", processing: "local", developerMode: "url", icon: "link",
    name: { "zh-TW": "URL 編碼與解碼", en: "URL Encoder and Decoder" }, shortName: { "zh-TW": "URL 編解碼", en: "URL encode" },
    description: { "zh-TW": "編碼或解碼網址參數值與完整網址。", en: "Encode or decode URL parameter values and complete URLs." },
    searchTerms: { "zh-TW": ["url encode", "url decode", "網址編碼", "百分比編碼", "percent encoding"], en: ["url encoding", "url decoding", "percent encode", "query parameter"] }, href: "/tools/url-encode-decode",
  },
  {
    slug: "unix-timestamp", category: "developer", workspace: "developer", processing: "local", developerMode: "timestamp", icon: "clock",
    name: { "zh-TW": "Unix 時間戳轉換", en: "Unix Timestamp Converter" }, shortName: { "zh-TW": "時間戳", en: "Timestamp" },
    description: { "zh-TW": "轉換 Unix 時間戳與 ISO 日期，查看 UTC、台北及本地時間。", en: "Convert Unix timestamps and ISO dates across UTC, Taipei, and local time." },
    searchTerms: { "zh-TW": ["unix timestamp", "時間戳轉換", "epoch time", "日期轉換", "毫秒時間"], en: ["unix time", "epoch converter", "timestamp to date", "date to timestamp", "milliseconds"] }, href: "/tools/unix-timestamp",
  },
  {
    slug: "regex-tester", category: "developer", workspace: "developer", processing: "local", developerMode: "regex", icon: "regex",
    name: { "zh-TW": "JavaScript 正規表示式測試", en: "JavaScript Regex Tester" }, shortName: { "zh-TW": "Regex 測試", en: "Regex tester" },
    description: { "zh-TW": "測試 JavaScript 正規表示式、查看群組並預覽取代結果。", en: "Test JavaScript regular expressions, inspect groups, and preview replacements." },
    searchTerms: { "zh-TW": ["正規表達式", "正則表達式", "regex tester", "regular expression", "regexp", "取代文字"], en: ["regex test", "regular expression tester", "regexp tester", "regex replace", "pattern match"] }, href: "/tools/regex-tester",
  },
  {
    slug: "3d-viewer", category: "3d", workspace: "3d", processing: "local", icon: "box",
    name: { "zh-TW": "3D 模型與空間檢視", en: "3D Model and Space Viewer" }, shortName: { "zh-TW": "3D 模型檢視", en: "3D viewer" },
    description: { "zh-TW": "本機預覽 3D 與 IFC 模型，以人體尺度漫遊及量測空間。", en: "Preview local 3D and IFC models, walk at human scale, and measure spaces." },
    searchTerms: { "zh-TW": ["3d 模型", "3d viewer", "ifc 檢視", "bim viewer", "模型預覽", "空間漫遊", "模型量測", "fbx viewer", "gltf viewer"], en: ["3d model viewer", "3d preview", "ifc viewer", "bim viewer", "walk through model", "scene scale", "fbx viewer", "gltf viewer"] }, href: "/tools/3d-viewer",
  },
];

export function localized<T extends LocalizedText>(value: T, locale: Locale = defaultLocale) {
  return getLocalizedText(value, locale);
}

export function getTool(slug: string) {
  return tools.find((tool) => tool.slug === slug);
}

export function getImageTool(slug: string): ImageTool | undefined {
  const tool = getTool(slug);
  return tool?.workspace === "image" ? tool : undefined;
}

export function getImageTools() {
  return tools.filter((tool): tool is ImageTool => tool.workspace === "image");
}

export function getTextTool(slug: string): TextTool | undefined {
  const tool = getTool(slug);
  return tool?.workspace === "text" ? tool : undefined;
}

export function getDeveloperTools() {
  return tools.filter((tool): tool is DeveloperTool => tool.workspace === "developer");
}

export function getTextTools() {
  return tools.filter((tool): tool is TextTool => tool.workspace === "text");
}

export function getToolsByCategory(category: Tool["category"]) {
  return tools.filter((tool) => tool.category === category);
}

function normalizeSearch(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-TW")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

function searchTokens(value: string) {
  const ignoredEnglishWords = new Set(["a", "an", "and", "for", "i", "in", "is", "it", "my", "of", "on", "please", "the", "to", "tool", "tools", "want", "with"]);
  return (normalizeSearch(value).match(/[\p{Script=Han}]+|[\p{L}\p{N}]+(?:[._+-][\p{L}\p{N}]+)*/gu) ?? [])
    .filter((token) => !ignoredEnglishWords.has(token));
}

function tokenMatchesCorpus(token: string, corpus: string) {
  const variants = [token];
  if (/[^s]ies$/u.test(token)) variants.push(token.slice(0, -3) + "y");
  else if (/(?:ches|shes|xes|zes)$/u.test(token)) variants.push(token.slice(0, -2));
  else if (/s$/u.test(token) && token.length > 3) variants.push(token.slice(0, -1));
  if (/ing$/u.test(token) && token.length > 5) {
    const stem = token.slice(0, -3);
    variants.push(stem, `${stem}e`);
  }
  return variants.some((variant) => corpus.includes(variant));
}

export function matchesTool(tool: Tool, query: string) {
  const normalizedQuery = normalizeSearch(query.trim());
  if (!normalizedQuery) return true;

  const searchableValues = [
    tool.slug,
    ...(tool.category === "image" ? ["圖片工具", "image tools", "photo tools"] : tool.category === "text" ? ["文字工具", "text tools", "writing tools"] : tool.category === "developer" ? ["工程師工具", "developer tools", "coding tools"] : ["3D 工具", "3d tools", "model viewer"]),
    tool.category,
    ...Object.values(tool.name),
    ...Object.values(tool.shortName),
    ...Object.values(tool.description),
    ...Object.values(tool.searchTerms).flat(),
  ].map(normalizeSearch);
  const searchableText = searchableValues.join(" ");

  if (searchableText.includes(normalizedQuery)) return true;
  const tokens = searchTokens(query);
  return tokens.length > 0 && tokens.every((token) => tokenMatchesCorpus(token, searchableText));
}

export function searchTools(query: string, category: "all" | Tool["category"] = "all") {
  const normalized = normalizeSearch(query);
  const score = (tool: Tool) => {
    if (!normalized) return 0;
    const names = [...Object.values(tool.name), ...Object.values(tool.shortName)].map(normalizeSearch);
    if (names.includes(normalized)) return 100;
    if (names.some((name) => name.includes(normalized))) return 80;
    const aliases = Object.values(tool.searchTerms).flat().map(normalizeSearch);
    if (aliases.includes(normalized)) return 60;
    if (aliases.some((name) => name.includes(normalized))) return 40;
    return 10;
  };
  return tools.filter((tool) => (category === "all" || tool.category === category) && matchesTool(tool, query))
    .sort((a, b) => score(b) - score(a));
}
