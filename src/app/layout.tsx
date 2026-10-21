import type { Metadata } from 'next'
import { SiteHeader } from '@/components/site-header'
import './globals.css'

export const metadata: Metadata = {
  title: { default: 'YOYO 工具站｜日常工具，整理簡單完成', template: '%s｜YOYO 工具站' },
  description: '在瀏覽器裡整理圖片與文字。免登入、不需上傳，支援繁體中文與英文工具搜尋。',
  applicationName: 'YOYO 工具站',
  openGraph: { title: 'YOYO 工具站｜日常工具，整理簡單完成', description: '在瀏覽器裡整理圖片與文字。免登入、不需上傳，支援繁體中文與英文工具搜尋。', locale: 'zh_TW', type: 'website' },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-Hant">
      <body><SiteHeader />{children}</body>
    </html>
  )
}
