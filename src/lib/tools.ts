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
  category: "image" | "text";
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

export type Tool = ImageTool | TextTool;

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
    .replace(/[\u0300-\u036f]/g, "");
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
    ...(tool.category === "image" ? ["圖片工具", "image tools", "photo tools"] : ["文字工具", "text tools", "writing tools"]),
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
