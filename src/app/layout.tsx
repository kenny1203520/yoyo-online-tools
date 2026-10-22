import { headers } from 'next/headers'
import { AppShell } from '@/components/app-shell'
import { defaultLocale, isLocale } from '@/lib/i18n'
import './globals.css'
import type { Metadata, Viewport } from 'next'
export const metadata: Metadata = { appleWebApp: { capable: true, title: 'YOYO', statusBarStyle: 'default' }, icons: { apple: '/icons/icon-192.png' }, other: { 'text-scale': 'scale' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0f766e' };

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const requested = (await headers()).get('x-yoyo-locale') ?? defaultLocale;
  const locale = isLocale(requested) ? requested : defaultLocale;
  return (
    <html lang={locale}>
      <body><AppShell>{children}</AppShell></body>
    </html>
  )
}
