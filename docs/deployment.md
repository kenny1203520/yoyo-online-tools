# 自行部署 YOYO 工具站

## 執行映像

需要 Docker／Compose。複製 repository 的 `compose.yaml` 與 `.env.example`，將後者另存為 `.env`。

```dotenv
SITE_URL=https://tools.example.com
SITE_INDEXABLE=true
```

`SITE_URL` 必須是 HTTP(S) origin，可含連接埠，不可含帳密、子路徑、查詢或 fragment。首版不支援 `/tools-app` 這類部署前綴。正式容器未設定時會立即以錯誤結束。

```bash
docker compose pull
docker compose up -d
docker compose ps
```

預設映像 `ghcr.io/kenny1203520/yoyo-online-tools:latest`。首次穩定標籤發布前，使用 `YOYO_IMAGE=ghcr.io/kenny1203520/yoyo-online-tools:edge`；fork 專案改成自己的全小寫 GHCR repository 名稱。映像未發布時可自行 `docker build -t yoyo:local .`。

容器以 UID 1001 執行，監聽 3000，不需資料庫與保存磁碟。`GET /api/health` 回傳 `{"status":"ok"}`。Compose 使用 init，映像以同一 Node 程序啟動 Next，停止時會收到 SIGTERM。

## 網域與 HTTPS

在容器前方使用 Caddy、Nginx 或既有 HTTPS 反向代理。將網域 DNS 指向主機；將 `SITE_URL` 設為訪客實際使用的 HTTPS origin。Caddy 的最小範例：

```caddyfile
tools.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

若代理也在容器內，兩個服務加入同一網路，upstream 改為 `web:3000`。本機代理可將 Compose 的 ports 綁定為 `127.0.0.1:3000:3000`。

## SEO 環境設定

所有設定都由伺服器於執行時讀取，不用重新建置映像。修改 `.env` 後執行 `docker compose up -d --force-recreate`。

| 設定 | 用途／預設 |
| --- | --- |
| `SITE_URL` | 必填，正式網站 origin |
| `SITE_INDEXABLE` | `false`；公開正式站才改成 `true` |
| `SITE_NAME_ZH_TW`、`SITE_NAME_EN` | 各語言 SEO 網站名稱，預設 YOYO 工具站／YOYO Tools |
| `SITE_DESCRIPTION_ZH_TW`、`SITE_DESCRIPTION_EN` | 首頁 SEO 描述 |
| `SITE_OG_IMAGE_ZH_TW`、`SITE_OG_IMAGE_EN` | 選填絕對 HTTP(S) 分享圖片網址，建議 1200×630 |
| `SITE_OG_ALT_ZH_TW`、`SITE_OG_ALT_EN` | 各語言分享圖片替代文字 |
| `GOOGLE_SITE_VERIFICATION` | 選填 Google 驗證碼 |
| `BING_SITE_VERIFICATION` | 選填 Bing 驗證碼 |

未指定分享圖片時使用 `/{locale}/share-image`，隨映像附帶 Noto Sans TC 與 OFL 授權，產生 PNG 不需外部字型服務。

索引開啟時，sitemap 由目前已上線工具登錄產生，共 14 個語言網址，並提供對應語言；robots 指向 sitemap。索引關閉時，頁面輸出 noindex、不允許 robots 爬取，sitemap 為空。robots 是爬取建議，不能當成私密網站的存取控制。

網站不會自行向 Google／Bing 提交；公開後可將 `/sitemap.xml` 加入各自的管理工具。沒有真實更新時間的頁面不捏造 `lastModified`。

## CI 與公開 GHCR

PR 和所有 push 都驗證 lint、型別、字典參數、搜尋、SEO、正式建置、瀏覽器以及 AMD64／ARM64 容器。瀏覽器測試涵蓋 Chromium、Firefox、WebKit 與手機尺寸模擬；不能代替實機 Safari／Chrome 驗收。

通過驗證後，預設分支發布 `edge` 及 `sha-<完整 commit>`；`vX.Y.Z` 標籤發布 `X.Y.Z` 並更新 `latest`。`vX.Y.Z-rc.1` 等預發布版本不更新 latest。Actions 固定 commit SHA，發布工作才取得 `packages: write`；fork PR 不登入 registry。映像包含來源標籤、SBOM 與 BuildKit provenance。

首次設定：

1. Repository 啟用 Actions，確認組織政策允許 workflow 發布 Packages。
2. 讓預設分支 workflow 成功執行，或推送正式版本標籤。
3. 至 repository 所屬的 Packages，開啟套件設定，將 visibility 設為 Public。GHCR 首次套件通常預設 private，workflow 發布不等於公開。
4. 登出 registry 的環境測試 `docker pull ghcr.io/<owner>/<repository>:edge`，分別確認兩種架構 manifest。
5. Fork 專案應確認 image 的來源 repository 與套件存取權已正確連結。

CI 不會登入其他人的伺服器或自動部署。建議在 GitHub 分支保護將 validate 與兩個 container 工作設為必要檢查。

## 更新、回復與驗證

正式部署建議固定版本標籤或 digest。於 `.env` 設定 `YOYO_IMAGE=ghcr.io/<owner>/<repository>:1.0.0`，再 pull／up。回復時改回上一版本或 digest 並重新建立容器；無資料庫遷移。

自行驗證：

```bash
docker build -t yoyo:test .
node scripts/container-smoke.mjs yoyo:test
```

測試同一映像使用兩個 SITE_URL、雙語 HTML、14 個 sitemap 網址、分享 PNG、非 root 身分及缺少 SITE_URL 的啟動失敗。ARM64 使用 `SMOKE_PLATFORM=linux/arm64`，並先準備原生主機或 QEMU。

本機 Windows 若同步軟體阻擋 `.next/standalone` 寫入，請使用 Docker 建置，或將專案放在不受同步軟體干預的位置。Linux CI 與 Docker 不依賴 Windows 產物。
