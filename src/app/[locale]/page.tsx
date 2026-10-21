import { notFound } from "next/navigation";
import { isLocale } from "@/lib/i18n";
import { pageMetadata, structuredData } from "@/lib/seo";
import { JsonLd } from "@/components/json-ld";
type Props = { params: Promise<{ locale: string }> };
export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  return isLocale(locale) ? pageMetadata(locale) : { robots: { index: false } };
}
export default async function Page({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <JsonLd value={structuredData(locale)} />;
}
