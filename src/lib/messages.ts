import zh from "@/messages/zh-TW.json";
import en from "@/messages/en.json";
export const messages = { "zh-TW": zh, en: en satisfies Record<keyof typeof zh, string> };
export type MessageKey = keyof typeof zh;
export type MessageRef = { key: MessageKey; values?: Record<string, string | number> };
export type MessageParameters = {
  changeLanguage: { language: string };
  languageResultCount: { count: number };
  batchLimit: { count: number }; addedImages: { count: number }; zipReady: { count: number };
  completedImages: { count: number }; customFields: { count: number }; downloadCompleted: { count: number };
  duplicateCount: { count: number }; maxImages: { count: number };
  removeFile: { name: string }; outputAlt: { name: string }; originalAlt: { name: string };
  smallerBy: { size: string }; largerBy: { size: string }; batchSummary: { count: number; size: string };
  fileError: { name: string; error: string }; unsupportedOutput: { format: string };
};
export type MessageArguments<Key extends MessageKey> = Key extends keyof MessageParameters
  ? [values: MessageParameters[Key]] : [values?: undefined];
export function message<Key extends MessageKey>(key: Key, ...args: MessageArguments<Key>): MessageRef {
  return { key, values: args[0] };
}
