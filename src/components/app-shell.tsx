"use client";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { NextIntlClientProvider } from "next-intl";
import { useEffect, useState } from "react";
import { defaultLocale, isLocale } from "@/lib/i18n";
import { getTool } from "@/lib/tools";
import { messages } from "@/lib/messages";
import { DirectoryContext } from "./directory-state";
import { SiteHeader } from "./site-header";
import { ToolDirectory } from "./tool-directory";

const ImageWorkspace = dynamic(() => import("./image-workspace").then((m) => m.ImageWorkspace));
const TextWorkspace = dynamic(() => import("./text-workspace").then((m) => m.TextWorkspace));
// The root host survives locale navigation. Tool content stays in browser memory.
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  const locale = isLocale(parts[0] ?? "") ? parts[0] as "zh-TW" | "en" : defaultLocale;
  const validLocale = isLocale(parts[0] ?? "");
  const tool = validLocale && parts.length === 3 && parts[1] === "tools" ? getTool(parts[2]) : undefined;
  const home = validLocale && parts.length === 1;
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<"all" | "image" | "text">("all");
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="UTC">
    <DirectoryContext.Provider value={{ query, setQuery, category, setCategory }}>
      <SiteHeader />
      {home && <main id="content" tabIndex={-1} className="main-shell"><ToolDirectory /></main>}
      {tool?.workspace === "image" && <ImageWorkspace tool={tool} />}
      {tool?.workspace === "text" && <TextWorkspace tool={tool} />}
      {children}
    </DirectoryContext.Provider>
  </NextIntlClientProvider>;
}
