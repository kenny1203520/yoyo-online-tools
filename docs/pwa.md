# PWA 安裝、離線與更新

## 使用方式

正式站需 HTTPS，本機 localhost 可測試。Chrome／Edge 使用安裝選單，iPhone／iPad 在 Safari 分享選單選「加入主畫面」。不支援程式觸發安裝的瀏覽器仍提供安裝說明。

在線開啟圖片、文字或工程師工具，等頁尾顯示「此工具與另一語言版本已可離線使用」。此時已準備該工具的雙語文件、程式、樣式與所需 Worker；圖片工具另準備 ZIP 模組。下載需要的結果後，離線重啟可處理新內容。未準備過的工具顯示離線說明；3D／IFC 不保證離線。

原文、檔案、設定與結果不會跨重啟恢復。不要將 PWA 快取視為備份。

## 快取與版本規則

- `manifest.webmanifest` 定義獨立視窗、作用範圍及標準／maskable PNG 圖示。安裝入口為 `/zh-TW`，兩語目錄都會在工具準備時快取。
- 正式建置的 `postbuild` 將 `.next/BUILD_ID` 寫入 Service Worker，輸出為未追蹤的 `public/sw.js`。部署必須保留建置輸出的 `public/`、`_next/static/` 與伺服器同一版本；禁止複用舊 `sw.js`。
- 快取名稱為 `yoyo-app-<build id>`。只接受同源、已知主要工具文件與版本化靜態資源；文件快取移除查詢字串，不快取 RSC 回應、API、使用者內容、模型、WASM 或第三方請求。
- 首次造訪 3D 時不預先準備其大型依賴。離線準備失敗時仍允許在線操作，且不顯示成功提示。
- 更新先進入 waiting，不會安裝後立即強制重載。頁面提示使用者先下載；確認後才啟用新版本、重載並刪除舊 `yoyo-app-` 快取。其他網站的快取不受影響。
- 開發模式不註冊 SW。測試正式版本前若曾測其他建置，可在瀏覽器 Application 工具清除此站的 SW 與快取，再重新準備。

## 重現驗證

```bash
npm ci
npm run build
node scripts/fetch-model-fixtures.mjs
npm run test:e2e
```

Windows 同步資料夾若無法產生 standalone，使用 `docker build -t yoyo:local .`，啟動指定 `SITE_URL` 的容器，再設定 `E2E_BASE_URL` 執行測試。範例環境需使用 `SITE_URL=https://tools.example.test`、`SITE_INDEXABLE=true`，以符合 SEO 測試。

預設執行 Chromium、Firefox、WebKit 及兩種手機模擬設定。本機另有安裝 Chrome／Edge 時，可設定環境變數 `E2E_SYSTEM_BROWSERS=1`，再執行 `npm run test:e2e -- --project=google-chrome --project=microsoft-edge`。這是實際瀏覽器執行自動化，不代替人工與實體手機驗收。

自動驗收涵蓋雙語離線重啟、Worker、圖片與 ZIP、空工作階段、未準備工具提示、Manifest、快取 URL／儲存隱私，以及實際 waiting→確認→activate→reload 的更新週期。離線測試會關閉反向代理來源伺服器，避免只靠瀏覽器的離線模擬而漏測 SW 網路。

實際安裝、OS 字體縮放與各平台系統整合仍依 [人工驗收腳本](manual-acceptance.md) 記錄。

參考：[Next.js PWA 指引](https://nextjs.org/docs/app/guides/progressive-web-apps)、[MDN Service Worker 使用方式](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers)、[MDN waiting](https://developer.mozilla.org/en-US/docs/Web/API/ServiceWorkerRegistration/waiting)。
