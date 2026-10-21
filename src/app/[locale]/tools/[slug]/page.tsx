import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { getTool } from "@/lib/tools";
import { pageMetadata, structuredData } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
type Props = { params: Promise<{ locale: string; slug: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale, slug } = await params;
  const tool = getTool(slug);
  return isLocale(locale) && tool ? pageMetadata(locale, tool) : { robots: { index: false } };
}
export default async function Page({ params }: Props) {
  const { locale, slug } = await params;
  const tool = getTool(slug);
  if (!isLocale(locale) || !tool) notFound();
  return <JsonLd value={structuredData(locale, tool)} />;
}
