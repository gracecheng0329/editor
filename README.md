# Archly 架構白板

Archly 是以系統架構討論為目標的白板專案，使用 Next.js、React 與 tldraw 建立互動介面。目前已實作 GitHub 登入、私密文件中繼資料管理、觀看連結與編輯者授權；另提供可操作的本機白板原型，以及獨立的多人同步技術驗證環境。

**正式文件畫布已使用 FigJam 風格介面。** 擁有者與編輯者可同步操作節點、有向連線及文字，並取得可靠保存確認；文件標題與分享權限沿用正式 API。筆畫與個人復原（S3）、留言（S4）、版本管理（S5）及既有連線撤權（#7）仍依各票驗收，不提前宣稱完整產品完成。

## 已實作功能與入口

| 入口 | 可使用內容 | 功能範圍 |
| --- | --- | --- |
| `/` | 產品介紹、GitHub 登入入口 | 經 Supabase Auth 完成登入 |
| `/documents` | 建立文件、列出自己擁有及受邀的文件、取得協作邀請 ID | 需要登入；中繼資料保存於 Postgres |
| `/documents/[id]` | FigJam 風格元件庫、浮動工具列、協作者與保存狀態；標題、分享與編輯者管理 | 正式 Auth／RLS、tldraw sync 與 Durable Object 保存；進階物件設定由右上按鈕開啟 |
| `/share#<token>` | 匿名以有效觀看連結讀取文件標題及觀看者身分 | 尚無畫布閱讀；撤銷或輪替後，舊連結的新請求會被拒絕 |
| `/prototype` | 本機架構白板 | 使用瀏覽器儲存，未連接產品文件或雲端同步 |
| `/g0` | 畫布與同步技術驗證 | 僅開發模式且 `G0_ENABLED=1` 時開放；同步測試由測試工具提供票證與本機 Worker |

### 文件與存取管理

- GitHub OAuth 登入、登出，以及登入失敗後重新嘗試。
- 建立、列出、開啟私密文件；擁有者可修改標題並於重載後讀回。
- 擁有者可產生、輪替及撤銷觀看連結；完整連結只在產生時顯示。
- 已完成 GitHub 登入的使用者可從「我的文件」複製自己的協作邀請 ID，由擁有者授予或撤銷編輯資格。
- 受邀編輯者可讀取文件，但不能管理標題、觀看連結或編輯者資格。可在正式文件畫布共同編輯節點、連線及文字。
- API 與資料庫 RLS／RPC 共同限制存取；分享連結不授予編輯資格。

### 正式協作畫布

正式頁面與 `/prototype` 共用浮動介面、架構元件庫、工具列和縮放控制。正式頁面的標題、權限、協作者及保存狀態來自實際服務；不會讀取原型的本機標題、留言、里程碑或示範畫布。右上「物件與連線」開啟座標、尺寸、連線端點與標籤設定；留言和版本面板明示待交付。

詳見 [介面整合驗證](docs/verification/formal-workspace.md)。

### 本機白板原型

`/prototype` 提供用戶端、服務、資料庫、儲存空間及訊息佇列節點，並支援節點命名、方向連線、文字、便利貼、自由手繪、整筆橡皮擦、平移縮放與復原／重做。

原型另有本機錨定留言、回覆、討論串解決／重新開啟，以及命名里程碑的獨立唯讀預覽。畫布使用 tldraw 的本機持久化，標題、留言與里程碑使用 `localStorage`；這些資料不會出現在產品文件清單，也不會同步到其他裝置。原型的分享介面僅呈現串接狀態，沒有可用的分享連結或雲端版本還原。

### G0 技術驗證

G0 已有本機測試覆蓋 SDK 掛載、觀看者服務端拒寫、同世代離線重連、快照保存與 runtime 重啟、個人復原，以及還原後的舊世代拒寫與舊畫布下載保留。這些測試使用獨立票證及本機 Durable Object，不代表正式產品的登入、分享、多人協作或版本還原已完成。證據與限制見 [G0 驗證紀錄](docs/verification/g0-results.md)。

## 技術架構

| 層次 | 技術 | 目前用途 |
| --- | --- | --- |
| Web 應用程式 | Next.js 16.4.5 App Router、React 19.3.0、TypeScript | 產品頁面、Route Handlers、OAuth callback 與 session 更新 |
| 畫布 | tldraw 5.5.2 | 正式／本機白板、自訂架構節點及 G0 畫布 |
| 同步驗證 | `@tldraw/sync`、`@tldraw/sync-core`、`@tldraw/tlschema` 5.5.2 | 正式文件及 G0 的 WebSocket 房間與同步協定 |
| Worker runtime | Cloudflare Durable Objects SQLite、Miniflare、esbuild | 正式權威畫布、可靠保存及 G0 世代驗證 |
| 身分與產品資料 | Supabase Auth、Postgres、`@supabase/ssr` | GitHub 登入、文件中繼資料、RLS 與分享／編輯者 RPC |
| 樣式與圖示 | Tailwind CSS 4、CSS、Lucide React | 白板與產品介面 |
| 驗證 | Playwright、Node.js test runner、Biome、TypeScript | 瀏覽器旅程、API／RLS 整合及工具測試 |

架構決策採用單一畫布同步引擎，並分開畫布與產品資料的權威來源。正式整合的目標分工見 [ADR](docs/ADR/README.md)；Durable Object 已用於正式畫布與 G0，本機 Supabase 環境未提供 Realtime、Storage 或 Edge Functions。

主要目錄：

```text
app/                    產品頁面、API、OAuth、本機原型與 G0 頁面
app/web/whiteboard/      本機白板介面、自訂節點與範例畫布
lib/                    Supabase server client、文件與分享共用邏輯
g0/                     同步驗證 Worker 與獨立 TypeScript 設定
supabase/migrations/    文件、分享、編輯者及授權的 SQL migrations
scripts/                本機服務、migration、OAuth preflight 與驗證工具
tests/s1/               文件與存取管理整合測試
tests/g0/               畫布同步技術驗證
docs/                   規格、架構決策、操作與驗收紀錄
```

## 安裝與啟動

### 環境需求

- 建議使用 Node.js 24；既有 G0 紀錄使用 Node.js 24.18.0。
- 使用 `package.json` 指定的 pnpm 11.18.0。
- 瀏覽器整合測試使用本機 Google Chrome（設定為 `channel: 'chrome'`）。
- 若使用內附本機 Supabase 腳本，需要 Apple silicon、macOS 26+ 與已安裝的 Apple `container`。這條路徑不依賴 Docker 或 Supabase CLI。

在專案根目錄安裝：

```sh
pnpm install --frozen-lockfile
```

### 先體驗本機白板

不需要 Supabase 設定即可啟動並開啟原型：

```sh
pnpm dev --hostname 127.0.0.1
```

前往 [本機白板原型](http://127.0.0.1:3000/prototype)。若要使用登入及產品文件功能，請接續設定 Supabase。

### 啟用登入與文件功能

1. 啟動內附的本機 Supabase，並套用 migrations：

   ```sh
   node scripts/local-supabase.mjs up
   pnpm db:migrate:local
   ```

   `up` 首次會下載映像及產生私密設定。migration runner 僅適用於本機 `editor-supabase-db`，會依序套用未執行的 SQL，並以 checksum 偵測已套用檔案的變更。

2. 建立或更新 `.env.local`，填入下節的兩個應用程式變數。本機值取自腳本產生的 `.local-supabase/app.env`；保留既有設定，只複製所需變數。

3. 依 [GitHub OAuth 設定指南](docs/verification/s1-oauth-deployment.md#本機-github-oauth) 建立本機專用 OAuth App，將 Client ID／secret 存入權限為 `0600` 的 `.local-supabase/github-oauth.env`，再執行一次 `node scripts/local-supabase.mjs up`。未配置時 GitHub provider 預設關閉。

4. 啟動或重新啟動 `pnpm dev --hostname 127.0.0.1`，使用 [http://127.0.0.1:3000](http://127.0.0.1:3000) 登入。固定 hostname 與 port；若改用其他 origin，必須同步調整 Auth redirect allow-list。

本機 GitHub OAuth App 的 callback 是 `http://127.0.0.1:54321/auth/v1/callback`；Supabase 允許返回的產品 callback 則是 `http://127.0.0.1:3000/auth/callback`，兩者需分別設定。

服務狀態與停止指令：

```sh
node scripts/local-supabase.mjs status
node scripts/local-supabase.mjs stop
```

本機 API 位於 `http://127.0.0.1:54321`，Studio 位於 `http://127.0.0.1:54323`。`stop` 保留資料卷與金鑰；完整服務及資料保存說明見 [本機 Supabase](docs/verification/local-supabase.md)。

## 環境變數

儲存庫目前沒有受版本控制的 `.env.example`；以下為 `.env.local` 的最小範例：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<本機 app.env 中的公開 anon key>
```

| 變數 | 何時需要 | 來源與用途 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 登入與產品文件功能 | 本機 API URL，或託管 Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 登入與產品文件功能 | 對應專案的公開 anon／publishable key；不可填 service-role key |
| `GITHUB_CLIENT_ID`、`GITHUB_CLIENT_SECRET` | 本機真實 GitHub OAuth | 只放 `.local-supabase/github-oauth.env`，由啟動腳本交給 GoTrue；不放前端變數 |
| `S1_CREDENTIALS_FILE` | S1 測試使用其他憑證路徑時 | 預設讀取 `.local-supabase/credentials.json`；可供獨立 worktree 指向既有本機環境 |
| `S1_ENABLED=1` | S1 Playwright 測試 | 測試設定自動提供，將 Next.js 產物分離至 `.next-s1` |
| `G0_ENABLED=1` | 開發模式的 G0 驗證頁面 | G0 測試設定自動提供，並將產物分離至 `.next-g0` |
| `G0_TEST_SECRET` | G0 Worker 與測試控制器 | Playwright 設定自動產生測試金鑰；不提供給瀏覽器 |

`.env*` 與 `.local-supabase/` 已由 Git 忽略。產品 Next.js 不需要 service-role key 或 GitHub client secret；測試工具才會使用本機私密憑證建立與清理測試身分。

## 檢查與測試

### 靜態檢查與建置

```sh
pnpm lint
pnpm exec tsc --noEmit
pnpm exec tsc -p g0/tsconfig.json
pnpm build
```

`pnpm build` 執行預設 `next build`。既有驗收紀錄曾遇到 Turbopack 環境限制，並使用以下 Webpack 路徑通過建置；部署指南亦採用此指令：

```sh
pnpm exec next build --webpack
```

### S1：文件與權限整合

先啟動本機 Supabase、套用 migrations，並確認 Chrome 已安裝、port 3101 可用：

```sh
pnpm db:migrate:local
pnpm test:s1
```

測試自動啟動獨立 Next.js 服務，覆蓋登入失敗處理、文件建立／改名／重載、分享輪替／撤銷、編輯者授權，以及直接 Data API／RPC 的權限邊界。測試會使用真實本機 Auth／Postgres 與隔離測試身分，並透過容器操作準備部分身分資料；不能取代真實 GitHub 雙帳號驗收。

### G0：畫布同步驗證

需要 Chrome，並保留 port 3100、8787、8788；不需要 Supabase：

```sh
pnpm test:g0
```

測試自動啟動 Next.js、Miniflare Worker 與重啟控制器，使用本輪獨立的暫存 SQLite 目錄。請將型別檢查與瀏覽器測試依序執行，避免 Next.js 生成型別時發生競爭。

### 設定工具與服務驗證

```sh
node --test scripts/test-local-github-oauth.mjs scripts/test-s1-preflight.mjs
node scripts/verify-local-supabase.mjs
node scripts/s1-preflight.mjs http://127.0.0.1:3000 http://127.0.0.1:54321
```

第一個指令使用隔離 fixture 測試設定工具；第二個需要已啟動的本機 Supabase，會建立及清理臨時身分與測試表；第三個需要已啟動產品服務且 GitHub provider 已配置，只檢查設定與重新導向，不執行真實登入或產品寫入。服務驗證若要包含停止／重啟與持久化檢查，可使用 `node scripts/verify-local-supabase.mjs --restart`，執行時避免與另一個 `up` 同時操作。

### 既有驗收的範圍

既有紀錄包含 G0 六項本機測試、S1 十二項整合測試，以及 2026-11-05 單一真實 GitHub 帳號的遠端文件與匿名分享驗收。第二個真實 GitHub 帳號的邀請／撤權旅程仍未驗證；詳細日期、版本與限制以各驗收文件為準，這些紀錄不表示本次 README 更新重新執行了完整測試。

## 部署與文件入口

Next.js 已設定 `output: 'standalone'`。現有遠端驗收使用 Vercel 與託管 Supabase；OAuth、環境變數及遠端 migrations 的設定方式見 [OAuth／部署指南](docs/verification/s1-oauth-deployment.md)。本機 migration runner 不接受遠端目標；既有遠端資料庫需先核對 migration 狀態。公開部署畫布前，另需確認 [專案背景](CONTEXT.md) 所列的 tldraw 授權要求。

| 文件 | 內容 |
| --- | --- |
| [專案背景](CONTEXT.md) | 目標、切片與整體邊界；較新的實作結果另見驗收紀錄 |
| [領域詞彙](GLOSSARY.md) | 文件、畫布、角色、分享與版本的定義 |
| [總規格](docs/specs/001-collaborative-architecture-whiteboard.md) | 產品目標及驗收條件，包含尚未實作內容 |
| [架構決策](docs/ADR/README.md) | 畫布同步引擎、資料權威、授權與世代還原 |
| [白板介面說明](docs/ui/figjam-inspired-whiteboard.md) | 本機白板原型的互動設計 |
| [本機 Supabase](docs/verification/local-supabase.md) | Apple container 安裝條件、服務與持久化 |
| [私密文件驗證](docs/verification/s1-private-documents.md) | S1 初期登入與私密文件的歷史紀錄 |
| [分享與編輯者驗證](docs/verification/s1-sharing.md) | 目前文件存取契約、測試與剩餘驗收 |
| [OAuth／部署驗證](docs/verification/s1-oauth-deployment.md) | 本機與遠端設定、preflight、真實瀏覽器驗收 |
| [G0 結果](docs/verification/g0-results.md)／[最小契約](docs/verification/g0-contract.md) | 同步、保存、快照與世代的技術證據及限制 |
| [Issue tracker](docs/agents/issue-tracker.md)／[PR 流程](docs/auto-pr.md) | 貢獻與審查工作流程 |
