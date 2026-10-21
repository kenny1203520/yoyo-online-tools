# YOYO 工具站

提供繁體中文與英文的瀏覽器工具，包含圖片壓縮、尺寸調整、格式轉換、文字清理、移除重複行與字數統計。免登入，圖片與文字只在目前瀏覽器工作階段處理。

## 開始使用

需求：Node.js 24 LTS（版本記錄於 `.nvmrc`）。

```bash
npm ci
npm run dev
```

開啟 <http://localhost:3000>，會轉至 `/zh-TW`。英文入口為 `/en`。

## 圖片工具

- `/{locale}/tools/image-compress`：調整圖片格式與畫質。
- `/{locale}/tools/image-resize`：等比例縮放圖片尺寸。
- `/{locale}/tools/image-convert`：轉換 JPG、PNG、WebP 格式。

支援靜態 JPG、PNG、WebP；每批最多 20 張，每張上限 20 MB／24 百萬像素。檔案只留在當前工作階段。可逐張自訂、比較處理前後大小、重試失敗項目，並下載單張或成功結果 ZIP。

## 語言與搜尋

完整繁中／英文介面由 `next-intl` 與具型別檢查的字典管理。兩種介面都能用中英文查詢名稱、用途及同義詞，例如 `compress image` 或「照片太大」。切換語言保留工作區內容、設定、結果與搜尋條件；重新整理或離開工具工作區會釋放內容。舊版無語言網址以 308 轉至繁中。

文字工具：`/{locale}/tools/text-cleanup`、`remove-duplicate-lines`、`word-count`。可貼上內容或匯入 UTF-8 TXT（上限 1 MiB），預覽、複製或下載結果。

## Docker 部署與 SEO

完整操作見 [部署說明](docs/deployment.md)。先複製 `.env.example` 為 `.env`，設定自己的 `SITE_URL`；公開正式站再將 `SITE_INDEXABLE` 設為 `true`。

```bash
docker compose up -d
```

預設下載 `ghcr.io/kenny1203520/yoyo-online-tools:latest`，首次穩定版本發布前可使用 `edge`，或自行建置：

```bash
docker build -t yoyo:local .
docker run --rm -p 3000:3000 --env-file .env yoyo:local
```

支援 Linux AMD64／ARM64。網域與 SEO 設定在執行時讀取，同一映像可部署至不同網域。內含雙語 metadata、canonical／hreflang、分享圖片、JSON-LD、`/sitemap.xml`、`/robots.txt` 與 `/api/health`。

映像是否已發布，應以 GitHub Actions 與 GHCR 套件頁為準；程式中的 workflow 不代表映像已公開。

## 專案指令

```bash
npm run dev       # 啟動開發伺服器
npm run lint      # ESLint
npm run typecheck # TypeScript
npm test          # 翻譯、搜尋、設定與 SEO 行為測試
npm run build     # 建置正式版本
npm run start     # 啟動正式版本
npx playwright install chromium firefox webkit
npm run test:e2e   # 瀏覽器驗收（需先 build）
```

正式執行 `npm start` 前必須設定 `SITE_URL`；開發模式預設使用 localhost。CI 以 Node.js 24 驗證，生產建置統一使用 Webpack。

產品決策見 [設計規範](docs/product-and-design.md)、[多語言與部署決策](docs/i18n-seo-deployment.md)。後續專業工具依 [文字與工程師工具實作計畫](docs/next-features-plan.md)推進。
