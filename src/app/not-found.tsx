"use client";
import Link from "next/link";
import { useI18n } from "@/lib/use-i18n";
export default function NotFound() {
  const { t, href } = useI18n();
  return <main className="main-shell workspace-empty"><h1>404</h1><p>{t("notFound")}</p><Link href={href()}>{t("allTools")}</Link></main>;
}
