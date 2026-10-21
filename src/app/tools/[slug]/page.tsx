import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ImageWorkspace } from "@/components/image-workspace";
import { TextWorkspace } from "@/components/text-workspace";
import { getTool, localized, tools } from "@/lib/tools";

type ToolPageProps = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({ params }: ToolPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) return {};
  const title = localized(tool.name);
  const description = `${localized(tool.description)} 檔案只在你的瀏覽器處理，不必上傳或登入。`;
  return { title, description, keywords: [title, ...Object.values(tool.name), ...Object.values(tool.searchTerms).flat()] };
}

export default async function ToolPage({ params }: ToolPageProps) {
  const { slug } = await params;
  const tool = getTool(slug);
  if (!tool) notFound();
  return tool.workspace === "image" ? <ImageWorkspace tool={tool} /> : <TextWorkspace tool={tool} />;
}
