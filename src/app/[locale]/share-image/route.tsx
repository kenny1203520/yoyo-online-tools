import { ImageResponse } from "next/og";
import { isLocale } from "@/lib/i18n";
import { getSiteConfig } from "@/lib/site-config";
import { readFile } from "node:fs/promises";
import path from "node:path";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) return new Response("Not found", { status: 404 });
  const config = getSiteConfig();
  const font = await readFile(path.join(process.cwd(), "public/fonts/NotoSansTC-Regular.otf"));
  return new ImageResponse(<div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: 80, background: "#f7f8f2", color: "#173f38", fontFamily: "YOYO" }}>
    <div style={{ display: "flex", fontSize: 72, fontWeight: 700 }}>{config.name[locale]}</div>
    <div style={{ display: "flex", marginTop: 36, fontSize: 32 }}>{locale === "en" ? "Everyday image and text tools." : "圖片與文字，輕鬆整理。"}</div>
    <div style={{ display: "flex", marginTop: 60, fontSize: 24, color: "#336a60" }}>{locale === "en" ? "In your browser · No sign-in · No uploads" : "瀏覽器內處理 · 免登入 · 不需上傳"}</div>
  </div>, { width: 1200, height: 630, fonts: [{ name: "YOYO", data: font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer, weight: 400, style: "normal" }] });
}
