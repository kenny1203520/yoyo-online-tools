import { headers } from 'next/headers'
import { AppShell } from '@/components/app-shell'
import { defaultLocale, isLocale } from '@/lib/i18n'
import './globals.css'

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
