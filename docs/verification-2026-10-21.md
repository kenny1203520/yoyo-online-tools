# 多語言與部署驗證紀錄

## 已執行

- Linux Docker／Node.js 24：乾淨 npm ci、ESLint、型別檢查、5 項行為測試與正式 Webpack／standalone 建置通過。
- 翻譯字典：227 個訊息鍵，兩語鍵與 ICU 參數一致；參數化介面呼叫受 TypeScript 檢查。
- Playwright：9 個情境 × 5 種設定，共 45 項通過。設定為 Chromium、Firefox、WebKit，以及手機 Chrome／Safari 尺寸模擬。
- 地球按鈕語言清單：Enter／Space、Tab／Shift+Tab、Escape、外部點擊、焦點離開、目前語言選擇與 query／hash 保留均通過。驗證 375／768／1024／1440px 的清單邊界、長名稱與增加項目後的垂直捲動；375／1440px 截圖已檢查。Safari 指標開啟按鈕時明確設定焦點。
- 驗證雙語 HTML、舊址 308 與 query 保留、未知語言／工具 404、canonical、hreflang、JSON-LD、14 個 sitemap 網址與 robots。
- 驗證中英文搜尋、無結果復原、語言切換保留查詢、文字、設定、圖片、覆寫、結果、錯誤與瀏覽器返回行為。
- 圖片單張下載檢查 JPG magic bytes；ZIP 解包檢查同名檔案不互相覆蓋；設定修改後過期結果不能下載。處理期間未觀察到上傳請求。
- 檢查 375、768、1024、1440px，包括加入圖片後的工作區；英文首頁另經截圖檢查。鍵盤跳至內容與搜尋流程通過。
- Linux AMD64 與 ARM64 映像建置成功。兩種架構皆使用 Node.js 24；ARM64 在 Docker Desktop 模擬執行。
- 同一映像分別使用兩個正式測試網域與一個禁止索引的預覽網域，驗證 metadata、sitemap、robots、雙語 1200×630 PNG 實際內容、UID 1001、健康檢查與缺少 SITE_URL 時的啟動失敗。
- Docker 健康狀態確認為 healthy；CI 使用的正式啟動指令另經 Linux 容器 HTTP 驗證。
- Workflow YAML 可解析，第三方 Actions 的版本對應 commit 已向 GitHub 核對；PR 無發布工作，發布需所有驗證成功。
- 正式 npm 依賴安全檢查：0 個已知漏洞。這不代表整個作業系統映像或開發依賴沒有漏洞。
- git diff --check 通過。

## 環境限制與待驗證

- Windows 同步資料夾直接產生 `.next/standalone` 時遇到 EPERM；正式建置改以 Linux Docker 完整驗證。Windows 本機為 Node.js 26，CI／容器另使用指定的 Node.js 24。
- 首次功能分支推送已通過 [GitHub Actions](https://github.com/kenny1203520/yoyo-online-tools/actions/runs/39611829784)，包含 validate 與 AMD64／ARM64 容器檢查；後續修訂依各提交的遠端檢查結果驗收。GHCR 首次發布後仍需確認套件 Public 與匿名 pull。
- Playwright Chromium／WebKit 不等於實際 Chrome、Edge、macOS Safari 或 iPhone／Android 實機；上述實機與讀屏驗收仍待進行。
- 尚未邀請 3–5 位一般使用者進行無口頭引導驗證。
- 本階段未擴大測試原先圖片引擎所有 EXIF 旋轉、超限、動畫及損毀檔組合；保留原版驗收清單供後續實機回歸。

部署方式與設定見 [deployment.md](deployment.md)，產品決策見 [i18n-seo-deployment.md](i18n-seo-deployment.md)。
