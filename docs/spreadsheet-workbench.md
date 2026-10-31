# CSV／XLSX 表格工作台：技術驗證與交付狀態

## T0 決策摘要

目前採用純瀏覽器處理，CSV／XLSX 解析與資料變更放在 Web Worker，表格使用虛擬化網格。這是可供驗收的初版技術組合，**尚未通過計畫所列的大檔效能及 Excel 保真門檻**。公開入口仍由 `NEXT_PUBLIC_ENABLE_SPREADSHEET_WORKBENCH` 控制，預設關閉；CI 驗收建置明確開啟此旗標，容器建置仍採預設關閉。

| 套件 | 版本 | 授權 | 用途與驗證狀態 |
|---|---:|---|---|
| `react-data-grid` | 7.0.0-beta.63 | MIT | 虛擬化、鍵盤導覽及儲存格編輯；使用 beta 版，尚未完成跨瀏覽器人工驗收 |
| `exceljs` | 4.4.0 | MIT | XLSX 讀寫；小型合成活頁簿測試公式、儲存格樣式及其他工作表往返 |
| `papaparse` | 5.7.0 | MIT | CSV 串流解析、分隔符號、引號與文字值處理 |
| `jszip` | 3.10.2 | MIT OR GPL-3.0-or-later | 掃描 XLSX 封裝中的危險／尚未支援內容；本專案選擇其 MIT 授權條款 |

## 功能保留與限制矩陣

| 內容／操作 | 目前行為 | 證據或限制 |
|---|---|---|
| CSV 匯入 | UTF-8、Big5、Shift-JIS、Windows-1252；可指定分隔符號、標題列 | `tests/unit/spreadsheet-processing.test.ts`、`spreadsheet-engine.test.ts`；瀏覽器 Worker 使用分塊解析 |
| CSV 值 | 匯入一律保留為文字；不將前導零或長數字自動轉型 | `CSV parsing preserves...`、`CSV formulas and leading-zero values stay strings...` 單元測試 |
| XLSX 公式、日期、儲存格樣式、多工作表 | 小型樣本往返測試通過；編輯後要求 Excel 開啟時重新計算公式 | `spreadsheet-engine.test.ts`；仍未由 Microsoft Excel 實際開啟驗證 |
| XLSX 版面檢視 | 顯示已讀入的儲存格文字、背景／文字色、字型、對齊、換行與邊框子集 | 不代表 Excel 完整版面；列高、欄寬、列印版面與全部格式尚未保證 |
| XLSX 結構編輯 | 停用列／欄插入與刪除 | 避免未驗證樣式、公式參照及合併區域被破壞 |
| XLSX 保護內容 | 公式格不可直接覆寫；含合併儲存格、名稱範圍、OOXML extension、圖表／繪圖／圖片、樞紐／切片器、外部連結／連線、表格、巨集、嵌入物件、註解擴充或自訂 XML/UI 的檔案阻擋編輯與匯出 | 封裝掃描及公式／合併格回歸測試；不宣稱 Excel 全格式保真 |
| CSV 儲存格／結構編輯 | 支援儲存格及範圍貼上、插入／刪除列欄、復原／重做 | 範圍貼上與結構操作先做邊界驗證；每份文件最多保留 50 個歷史命令 |
| 清理、追加、關聯、比對 | 在瀏覽器產生獨立結果；結果確認後才可匯出；來源變更後舊結果失效 | `spreadsheet-processing.test.ts` 與 `spreadsheet-engine.test.ts`；衝突不產生多對多結果 |
| 隱私／保存 | 工作階段在記憶體及 Worker 中處理；Service Worker 僅快取應用資源，不保存工作內容 | PWA 快取僅允許同源 HTML 與靜態程式；頁面重載不恢復表格內容 |

XLS、XLSM、XLSB、加密或損壞活頁簿不接受。發現尚未確認可安全保留的內容時，應先阻擋匯出，不移除內容後繼續下載。

## 限制值不是支援承諾

目前的安全上限為 CSV 100 MiB、XLSX 50 MiB、最多 1,000,000 列、1,000 欄及 20,000,000 格；單次編輯最多 50,000 格。這些是拒絕超限輸入的保護值，**尚未證明達到可用效能**。頁面以每頁 100 列顯示，Worker 匯入仍需完整解析及保留資料。

| 計畫基準 | 量測狀態 | 結果 |
|---|---|---|
| 16 GB 桌機，CSV 100 MB | 待實機量測 | 不宣稱支援 |
| 16 GB 桌機，CSV 1,000,000 列 | 待實機量測 | 不宣稱支援 |
| 16 GB 桌機，XLSX 50 MB／跨表 200,000 列 | 待實機量測 | 不宣稱支援 |
| 匯入、捲動、編輯、清理、合併、取消、匯出及記憶體峰值 | 待建立正式量測紀錄 | 不宣稱通過 |

合成測試資料可由下列自動化測試重現，沒有外部使用者資料或第三方範例檔：

```powershell
npm test
npm run test:e2e -- --project=chromium --grep "spreadsheet"
```

端到端驗收建置須以 `NEXT_PUBLIC_ENABLE_SPREADSHEET_WORKBENCH=true` 建置及啟動；正式入口保持關閉，直到發布門檻通過。CI 已使用該旗標執行 spreadsheet E2E，但本地目前尚未完成 E2E 與完整正式建置。

## 下一階段驗收清單

- [x] 工具入口受功能旗標控制，CI 驗收版本可以啟用。
- [x] XLSX 小型合成樣本保留公式、樣式與其他工作表；資料日期值復原後保持 Date 型別。
- [x] CSV 列欄編輯、範圍修改的原子拒絕、復原／重做有單元測試。
- [x] CI 的 E2E 建置啟用功能旗標；新增 CSV 編輯、清理、匯出、RWD 及 Chromium 離線流程測試。
- [ ] Node.js 24 全套 CI、跨 5 種 Playwright 設定及雙架構容器完成。
- [ ] 大型檔案效能矩陣及記憶體峰值紀錄完成。
- [ ] 由 Microsoft Excel 開啟原始往返與修改後活頁簿，檢查公式重算與版面。
- [ ] Chrome、Edge、Firefox、Safari、iPhone Safari、Android Chrome 真機驗收。
- [ ] 3–5 位一般使用者及 2–3 位工程師完成無引導任務驗收。
- [ ] 結果通過後再啟用公開入口、建立 PR 並合併回 `develop`。

未勾選的人工或硬體項目維持待驗收，不得以本文件的程式測試代替。
