# 專案完成度稽核與改善驗收

日期：2026-10-22（Asia/Taipei）。基準為目前工作目錄，包含本輪之前已有的未提交變更。

**整體尚未結案。** 程式、自動化、真機與使用者訪測分開記錄；不以完成百分比或舊版通過數字代替證據。

## 本輪修正

| 規格／問題 | 實作與驗收來源 | 狀態 |
| --- | --- | --- |
| JSON 精度、重複鍵、錯誤行欄、深度 | `developer-processing.ts`、`code-editor.tsx`；單元與 audit E2E | 已實作；最終矩陣見下 |
| 陣列／物件、缺值／null、特殊鍵、數值比較 | `developer-processing.ts`；`developer-tools.test.ts` | 單元通過 |
| 不存在日期、秒／毫秒精度、負時間戳 | `developer-processing.ts`；單元及時間戳 E2E | 已實作；最終矩陣見下 |
| 時間戳可編輯及雙向轉換 | `developer-workspace.tsx` | 已實作 |
| Base64／Base64url、UTF-8、填補規則 | `developer-processing.ts`；單元測試 | 單元通過 |
| URL 單層編解碼與保留 `+` | `developer-processing.ts`；單元測試 | 單元通過 |
| 工程師工具工作階段隔離、覆蓋確認、清空還原 | `app-shell.tsx`、`developer-workspace.tsx`；audit E2E | 已實作 |
| 設定／輸入修改後舊結果失效、過期回應拒收 | `developer-job.ts` 的 requestId／version；競態 E2E | 已實作 |
| JSON／比對 5 秒、Regex 2 秒與取消 | `developer.worker.ts`、工作區；截止及重試 E2E | 已實作，截止從 Worker 就緒後開始 |
| 每欄 1 MiB、每側 10,000 行、4 MiB 輸出、2,000 差異 | 共用工作處理與單元測試 | 已實作，超限報錯，禁止截斷匯出 |
| Regex 旗標能力、群組、高亮、替換及 1,000 匹配上限 | 工作區、共用工作處理；單元及 E2E | 已實作 |
| 一般文字清理、去重、Unicode 統計、UTF-8 | `text-processing.ts`、`text.worker.ts`；文字單元與既有 E2E | 已實作；單元通過 |
| 圖片設定、過期輸出、同名 ZIP 與下載格式 | `image-workspace.tsx`；既有及離線 E2E | 保留並回歸 |
| 16px 正文／表單、14px 輔助、可調程式碼字級 | `globals.css`、工作區 | 已實作，相對單位，不覆寫根字級 |
| 雙語五寬度、320px 重排、200% 文字 | audit E2E；截圖存於 `test-results/` | 自動化檢查；另需人工讀屏／真機 |
| PWA Manifest、圖示、安裝提示 | `manifest.ts`、`public/icons/`、`pwa-status.tsx` | 已實作；實際安裝待人工 |
| 雙語文件、主要工具／Worker／ZIP 離線 | `service-worker.js`、共用 Worker 建構位置；關閉來源測試 | 已實作 |
| 等待更新、確認後重載、舊快取清理 | 真實 Service Worker 版本更新 E2E | 已實作 |
| 僅快取應用資源、內容不持久保存 | SW 白名單、Cache Storage／storage E2E | 已實作；人工補查 IndexedDB／Network |
| GLB／glTF／FBX／IFC／ZIP、外部資產 | 固定官方樣本與 models E2E | 已實作；來源見樣本清單 |
| IFC Worker、分批場景組裝、取消、兩分鐘截止 | `ifc.worker.ts`、模型工作區 | 已實作 |
| IFC 樓層／構件、選取、高亮、隱藏及恢復 | 模型工作區與 models E2E | 已實作；實際模型待人工 |
| 量距、校準、單位與多主模型選擇 | 模型工作區與 models E2E | 已實作，修正兩點後校準表單消失 |
| 第一／第三人稱、觸控與人體比例 | 既有模型控制 | 待真機與實際情境完整驗收 |

## 驗證紀錄

- 最終來源已在 Linux／Node.js 24.22.1 通過 lint、typecheck 及 **23／23 單元測試**，涵蓋資料正確性、文字及外部資產路徑。
- `npm audit --omit=dev` 回報正式依賴 0 個漏洞；此結果不涵蓋開發依賴。
- AMD64 正式建置與 ARM64 原生架構建置成功。最終 ARM64 映像沿用原生 ARM Node／依賴，再複製最終 AMD64 建置的可攜 `.next`／`public`，使最後的檔案錯誤語系修正一致；已確認 `.next` 不含 `.node` 原生二進位檔。沒有宣稱這個最後修正另做一次原生 ARM 編譯。
- 兩個最終映像均通過三個網域的 SEO／禁止索引、雙語 1200×630 PNG 分享圖片、UID 1001、健康檢查及缺少必要網域設定時的啟動失敗。ARM64 由 Docker Desktop 模擬執行，不能當作實體 ARM 裝置效能。
- 本輪修正 Firefox Service Worker 在 Worker 啟動時等待 `clients.get()` 的阻塞，以及 hydration 前編輯造成輸入遺失的競態；測試現在會先確認 SW 已控制頁面及輸入已可操作。

### 最終瀏覽器結果

| 設定 | 最終完整矩陣 | 執行環境 |
| --- | --- | --- |
| Chromium | 26／26 | Playwright 桌面 |
| Firefox | 26／26 | Playwright 桌面 |
| WebKit | 26／26 | Playwright 桌面 |
| Mobile Chrome | 26／26 | 桌面引擎模擬手機 |
| Mobile Safari | 26／26 | 桌面引擎模擬手機 |
| Google Chrome 155.0.8059.85 | 26／26 | Windows 實際安裝版本、headless |
| Microsoft Edge 155.0.4283.62 | 26／26 | Windows 實際安裝版本、headless |

最終來源的五設定完整矩陣於 2026-10-22 07:52 UTC（台北 15:52）開始，26×5＝130 項全數通過，耗時約 198 秒；實際 Chrome／Edge 的完整 52 項也全數通過。兩輪均無失敗、重試、跳過或 flaky。最後的檔案錯誤語系修正已包含在這些完整結果內；先前另跑的 5 項語系回歸報告也保留備查。

測試涵蓋雙語 320／375／768／1024／1440 CSS px、200% 文字、下載正確性、取消與過期結果、真正停止來源伺服器的離線重啟、雙語切換、未快取工具、等待更新及內容未保存。

### 公開模型量測

約 49 MB 的 IFC（49,286,967 bytes、714,485 個 STEP 實體）在五設定的載入／取消量測如下。實體數不是構件或三角面數；實際模型仍需記錄其幾何複雜度。

| 設定 | 載入 | 取消回應 |
| --- | --- | --- |
| Chromium | 5,160 ms | 82 ms |
| Firefox | 2,812 ms | 75 ms |
| WebKit | 5,759 ms | 391 ms |
| Mobile Chrome 模擬 | 3,666 ms | 88 ms |
| Mobile Safari 模擬 | 4,160 ms | 238 ms |

GLB、含外部貼圖與父目錄路徑的 glTF ZIP、嵌入貼圖 FBX、一般 IFC、多主模型、缺失資產、校準及 IFC 操作均納入自動化。各格式及實際 Chrome／Edge 的詳細量測見下方 JSON。手機設定為桌面模擬，不能當作實機速度保證。

### 版本與證據

- 可攜建置 ID：`Pne5ZUy62hV2rKDu2w42R`。
- AMD64 `yoyo:audit` 映像 ID：`sha256:0e8dfb588b52f84da0e703322bca456b6dc1c7201886ff4ec47664317bf04aab`。
- ARM64 `yoyo:audit-arm64-final` 映像 ID：`sha256:73841742aab44879adef62107890d9a109ff9ef8f9fd873c8abeca680022a433`。這些是本機映像 ID，不是公開 registry digest。
- 執行碼來源指紋（56 檔）：`b77e3d37e1de93bcac2458d140e714b9900017fd20afe33542ee0f9d573c6df0`。演算法及涵蓋範圍記錄於 JSON；包含未提交內容，不能只用 HEAD 識別。
- 可提交的摘要與量測：[`verification-2026-10-22.json`](verification-2026-10-22.json)。完整本機報告：`out/final-browser-results.json`、`out/locale-browser-results.json`、`out/system-browser-results.json`；摘要記錄其 SHA-256，`out/` 不納入 Git。

## 仍不可標為完成的事項

1. 各平台的人工安裝、鍵盤、讀屏與 OS 字體縮放，以及實體 macOS Safari、iPhone／Android 與 Firefox 使用情境。Windows Chrome／Edge 已有實際安裝版本的自動化證據，但不代替人工驗收。
2. 3–5 位一般使用者及 2–3 位工程師的無引導訪測；由使用者協調，腳本見 [manual-acceptance.md](manual-acceptance.md)。
3. 使用者實際大型模型、第一／第三人稱、碰撞、觸控與人體比例的任務驗收；官方樣本成功不代表所有 IFC 可用。
4. 本輪修改尚未推送，沒有可引用的對應遠端 CI／發佈紀錄。GitHub 連接器對目前 HEAD 的 PR workflow 查詢回傳空清單，不能推論所有分支工作失敗或成功。
5. 2026-10-22 的 GHCR 匿名 token 請求回傳 HTTP 403；`edge` manifest 查詢為 `manifest unknown`。公開映像／匿名拉取尚未確認，不能宣稱已發佈完成。

## 重現與來源

- `npm run lint`、`npm run typecheck`、`npm test`、`npm run build`、`node scripts/fetch-model-fixtures.mjs`、`npm run test:e2e`。
- Windows 同步目錄使用 Linux 容器建置，再透過 `E2E_BASE_URL` 測試；Playwright 使用 2 workers，避免多份大型模型同時耗盡資源。
- 模型來源、固定提交、位元組數與 SHA-256：[`tests/fixtures/models/sources.json`](../tests/fixtures/models/sources.json)。下載檔不納入 Git 或正式映像；原始授權依來源倉庫。
- 訪談決策：[`notes/2026-10-22-project-audit-grill.md`](../notes/2026-10-22-project-audit-grill.md)。PWA 行為與重現方式見 [pwa.md](pwa.md)。
