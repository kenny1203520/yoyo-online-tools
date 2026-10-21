import Link from "next/link";
import { ArrowDownToLine, Menu } from "lucide-react";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="brand" href="/" aria-label="YOYO 工具站首頁">
          <span className="brand-mark" aria-hidden="true"><ArrowDownToLine size={19} strokeWidth={2.4} /></span>
          <span>YOYO <span className="brand-light">工具站</span></span>
        </Link>
        <nav className="desktop-nav" aria-label="主要導覽"><Link href="/#tools">全部工具</Link><Link href="/#image-tools">圖片工具</Link><Link href="/#text-tools">文字工具</Link><Link href="/#guide">使用說明</Link></nav>
        <Link className="mobile-nav-link" href="/#tools" aria-label="前往工具目錄"><Menu size={20} />工具目錄</Link>
      </div>
    </header>
  );
}
