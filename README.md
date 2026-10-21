# YOYO 工具站

以繁體中文提供實用的線上工具，圖片工具已可使用，並支援英文搜尋。後續功能依 [文字與工程師工具實作計畫](docs/next-features-plan.md)分階段交付；尚未實作的工具不會顯示為可用入口。

## 開始使用

需求：Node.js 20.9 或更新版本。

```bash
npm install
npm run dev
```

開啟 <http://localhost:3000>。

## 圖片工具

- `/tools/image-compress`：調整圖片格式與畫質。
- `/tools/image-resize`：等比例縮放圖片尺寸。
- `/tools/image-convert`：轉換 JPG、PNG、WebP 格式。

支援靜態 JPG、PNG、WebP；每批最多 20 張，每張上限 20 MB／24 百萬像素。檔案只留在當前工作階段。可逐張自訂、比較處理前後大小、重試失敗項目，並下載單張或成功結果 ZIP。

## 語言與搜尋

目前介面以繁體中文顯示；工具目錄同時以繁體中文和英文名稱、用途及同義詞搜尋。例如可輸入 `resize image` 找到圖片尺寸調整工具。工具文案與搜尋關鍵字以語系資料分開維護，供後續擴充介面語言。

## 專案指令

```bash
npm run dev       # 啟動開發伺服器
npm run lint      # ESLint
npm run typecheck # TypeScript
npm run build     # 建置正式版本
npm run start     # 啟動正式版本
```

產品決策、設計規範、路由與驗收方向見 [`docs/product-and-design.md`](docs/product-and-design.md)。
