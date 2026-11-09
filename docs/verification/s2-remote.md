# S2 遠端驗收

這是遠端驗收工具，不是已通過的驗收紀錄。使用真實部署、兩個不同合法 OAuth 使用者及獨立 browser contexts，不讀本機 Supabase credentials，不建立假 GitHub identity，不使用 service-role key。

## GPT 內登入：本機開發前端／真實遠端服務

使用者要求登入操作全部留在 GPT 內，不開外部 Chrome 視窗。內建瀏覽器共用 Cookie，因此先依序保存兩個真實帳號的有效 session，再由無介面的 Playwright 載入到兩個獨立 browser contexts。這條路徑的證據必須標為 `local-development`，不能取代正式部署前端的完整雙帳號 smoke。

- 遠端協作服務使用獨立的 `sync/wrangler.acceptance.jsonc`（`editor-canvas-acceptance`）；Supabase 使用既有真實遠端測試專案。房間儲存與正式 Worker 隔離。
- 本機私有設定在 `.s2-remote/local-frontend.env`，指定 `S2_LOCAL_FRONTEND=1`、`S2_APP_ORIGIN=http://127.0.0.1:3103`、`S2_WORKER_ORIGIN=https://editor-canvas-acceptance.yurisine7.workers.dev` 及對應的遠端 Supabase 公開設定。`S2_DEPLOYMENT_COMMIT` 在此表示本機 checkout 的基底 commit；前端包含未提交的驗收工具變更，不能當成已部署版本。
- 執行 `node scripts/s2-local-frontend.mjs` 及 `node scripts/s2-in-app-login.mjs`。前者啟動隔離的 `.next-s2-remote` 開發前端並停用請求日誌；後者只監聽 `127.0.0.1:3104`。
- 在 GPT 內開啟 `http://127.0.0.1:3103/documents` 完成 owner 的 GitHub 登入，再到 `http://127.0.0.1:3104/` 按「保存 owner session」。助手透過遠端 Auth 驗證身分後，只把該專案的 Auth Cookie 寫到 Git 忽略目錄，目錄 0700、檔案 0600，頁面不回傳憑證。
- 按「清除本機頁面的登入 Cookie，以切換下一個帳號」，再使用 GitHub 的 Account switcher → Add account，在 GPT 內登入另一帳號。不要呼叫產品的「登出」：那會撤銷已保存的 Supabase session。GitHub 切換完成後回本機文件頁登入，再到助手保存 editor session；相同身分會被拒絕。
- 助手限制 Host、POST Origin、表單 nonce 及 body 大小；不是產品或遠端部署端點。跨 Origin 及錯誤 nonce 的拒絕檢查已實跑通過，保存的 owner state 亦已實跑確認可讀取遠端產品資料。

兩個帳號都保存後，執行：

```sh
node --env-file=.s2-remote/local-frontend.env node_modules/@playwright/test/cli.js test --config playwright.s2-remote.config.ts --grep 'smoke: real identities'
S2_REMOTE_MODE=prepare node --env-file=.s2-remote/local-frontend.env node_modules/@playwright/test/cli.js test --config playwright.s2-remote.config.ts
```

接著對 **acceptance Worker** 部署更新（例如加入新的 `ACCEPTANCE_RUN_ID` binding，保留相同 namespace／SQLite），再執行：

```sh
S2_REMOTE_MODE=verify node --env-file=.s2-remote/local-frontend.env node_modules/@playwright/test/cli.js test --config playwright.s2-remote.config.ts
```

verify 會等待公開 checkpoint 的 instance ID 確實改變，再檢查兩人看到的內容；單有部署成功訊息不算實例重建證據。此處只執行使用者要求的協作／保存／恢復旅程；分享觀看者的獨立測試與缺口仍另外記錄。

## 部署前置

1. 部署包含本次 `instanceId` checkpoint 欄位的 Worker。`sync/wrangler.jsonc` 的 `APP_ORIGIN` 是精確的前端 origin，不能有尾端 `/`；`SUPABASE_URL` 指向同一個託管專案。設定 `SUPABASE_ANON_KEY`、`ROOM_SIGNING_SECRET` secrets。
2. Vercel 的 `NEXT_PUBLIC_SYNC_URL` 指向該 Worker 的 HTTPS origin；重新 build／部署。核對 Supabase migrations、OAuth callback、tldraw 網域授權及實際部署 commit。
3. 使用專用測試帳號及文件。測試會建立文件及授予 editor 權限，為方便查驗會保留文件。完成後由 owner 在產品刪除測試文件；本工具不刪除使用者。
4. 若有 Vercel Deployment Protection，在下面每個登入瀏覽器先完成其合法 SSO；匿名 browser context 仍須能到產品，才能驗收匿名分享。不要把 SSO 保護頁當成產品頁。

## 保存真實登入 session

在 repo 根目錄執行，下列兩個瀏覽器分別登入不同 GitHub 帳號，確認到達 `/documents` 後關閉視窗。JSON 含有效 session，只保留在已忽略的私有目錄，不提交或附到 issue。

```sh
mkdir -p .s2-remote
chmod 700 .s2-remote
export S2_APP_ORIGIN=https://editor-gracecheng0329s-projects.vercel.app
export S2_WORKER_ORIGIN=https://REPLACE-WITH-WORKER.workers.dev
export S2_DEPLOYMENT_COMMIT=REPLACE-WITH-VERIFIED-APP-COMMIT
pnpm exec playwright codegen --save-storage=.s2-remote/owner.json "$S2_APP_ORIGIN/documents"
pnpm exec playwright codegen --save-storage=.s2-remote/editor.json "$S2_APP_ORIGIN/documents"
chmod 600 .s2-remote/owner.json .s2-remote/editor.json
```

Worker URL 與 Vercel URL 是不同服務，不能填同一網址。此設定沒有 `webServer`，不會啟動本機服務。session 過期時重新登入，不要停用 Auth 驗證。

## 協作與拒絕存取 smoke

```sh
S2_REMOTE_MODE=smoke pnpm exec playwright test --config playwright.s2-remote.config.ts
```

檢查兩個身分不同、授權前拒絕存取、協作者身分、雙向節點操作、兩秒傳遞、五秒同節點收斂及不產生副本、選取隔離、失敗保存不顯示成功及恢復、匿名 checkpoint 拒絕、無效 WebSocket 票證、跨文件票證與不受信任 Origin 拒絕、重開內容。checkpoint 503 由 browser HTTP route 注入，須明確記為故障注入，而非實際遠端平台故障。協作測試成功結果保存在 `.s2-remote/collaboration.json`；它只代表第一條旅程。分享觀看者是另一條獨立測試，兩條均通過才算 smoke 通過。失敗不產生通過紀錄。每次執行前移走舊結果，避免將舊通過紀錄當成本輪結果。

## 真正遠端實例重建後恢復

```sh
S2_REMOTE_MODE=prepare pnpm exec playwright test --config playwright.s2-remote.config.ts
```

準備階段建立新文件，保存一個節點及另一個節點的刪除結果，將權威 checkpoint 和 DO instance ID 寫入 `.s2-remote/baseline.json`。該檔不含票證或 session，但含畫布內容，仍不可公開。

關閉測試頁面後，在相同 Worker／相同 Durable Object namespace 部署程式碼更新。保留 SQLite、binding、namespace、簽章 secret 及 migrations。記錄舊／新 Cloudflare deployment ID 與執行時間；不要刪除 namespace 或資料來模擬重啟。Cloudflare 更新可能延後套用，deploy 指令成功本身不足以證明房間實例重建。

```sh
pnpm exec wrangler deploy --config sync/wrangler.jsonc
S2_REMOTE_MODE=verify pnpm exec playwright test --config playwright.s2-remote.config.ts
```

verify 強制 instance ID 與基準不同，並比較完整公開畫布 records、世代、頁面節點及刪除結果。相同實例會失敗，不能將這次執行記為重啟通過。單純重新部署相同程式可能不觸發替換；依平台實際 code update 完成後再執行，不加入公開重啟端點。成功產生 `.s2-remote/recovery.json`。

instance ID 為 DO constructor 產生的非持久隨機 ID，只有經原有身分／文件授權的 checkpoint 回傳；它證明房間實例重建，不宣稱整個 Cloudflare 主機重啟。

## 驗收證據與尚未涵蓋項目

記錄日期、App commit／origin、Worker deployment ID／origin、Supabase project、瀏覽器版本、網路條件、命令與結果，以及重建前後 instance ID。報告不附 Cookie、access token、分享 token 或完整網路 trace。本設定關閉 trace、影片與截圖；預設只顯示測試清單。

另有獨立分享觀看者測試，驗證匿名及已登入觀看者的正式入口、唯讀狀態、同步畫布、後續變更及 checkpoint 拒絕。目前 checkout 的 `app/share/reader.tsx` 仍只有畫布佔位，預期這項驗收會揭露缺口，不能跳過後宣稱通過。

本工具尚未自動涵蓋 viewer 直接送出合法同步寫入的完整拒寫矩陣、viewer 平移縮放、過期／撤銷分享、落後 checkpoint 回應與斷網待同步旅程；這些仍須補上遠端證據。`smoke` 及 `verify` 通過都不代表 #5 的所有 AC 通過，不能據此自動關閉 #5。

參考：`s2-owner.md`、`s2-collaboration.md`，以及 Cloudflare Durable Object lifecycle 官方文件。

## 2026-11-09 遠端執行前檢查

- 由 `sync/wrangler.jsonc` 找到 App origin `https://editor-gracecheng0329s-projects.vercel.app` 與 Supabase origin `https://gnmaayjhlnrlqcpxkjjw.supabase.co`。Worker 名稱為 `editor-canvas`，但設定不含帳號子網域，不能據此猜測 workers.dev 網址。
- GitHub `commits/main/status` 回報 commit `514fa1f6648fa4bfaf69e924ca730a82f900fa84` 的 Vercel 狀態 success，對應部署 `8kTchXrDd2S3RMLy4UDu2B9BHZVN`。這只證明該 commit 有成功部署，尚未核對驗收 alias 與 Worker 實際版本。GitHub deployments API 回傳空陣列。
- 命令列執行 `node scripts/s1-preflight.mjs https://editor-gracecheng0329s-projects.vercel.app https://gnmaayjhlnrlqcpxkjjw.supabase.co`，exit 1：`Product homepage failed; check the deployment and Auth configuration.` 同一 origin 的匿名 HTTP 請求回應 302，導向 Vercel SSO。未停用或繞過部署保護。
- 內建瀏覽器可見正式產品首頁及 `/documents` 的登入提示。點擊正式登入入口後，抵達 GitHub 的 Editor OAuth 登入頁，尚未輸入帳號或密碼；因此尚無產品 Auth session。
- Cloudflare Dashboard 抵達登入頁，沒有可沿用的帳號 session。既有 `.s2-remote/`、本機 Wrangler 登入設定及部署 metadata 均不存在；未讀取其他瀏覽器的 Cookie 或密碼。
- 結果：**遠端前置檢查已執行，但 S2 smoke、prepare、verify 尚未執行**。需要在瀏覽器完成 Cloudflare 登入以查 Worker，以及兩個不同 GitHub 測試帳號的產品登入。未建立測試文件、未重新部署、未執行 migration、未變更部署保護，不宣稱 #5 完成。

### 完成登入後的實際產品驗收

- 原 OAuth 流程因等待而回報 `bad_oauth_state`；由正式入口重新登入後成功進入 `/documents`，未更改 OAuth 設定。
- 正式產品成功建立測試文件 `b8680210-de8d-44b7-a797-d9e0822ae641`（標題 `S2 remote acceptance 2026-11-09`）。開啟正式文件後可見擁有者及存取設定，但畫布位置顯示 **「畫布同步服務尚未設定。」**；因此節點編輯／可靠保存 smoke 在此被阻擋，不記為通過。
- 已登入 Cloudflare 的 Workers & Pages 清單明確顯示 **No projects found / You have not created any projects yet**。帳號 workers.dev 子網域為 `yurisine7.workers.dev`，尚未存在 `editor-canvas` 部署，不能將推算的服務網址當成已部署結果。
- Vercel 專案環境變數中可見 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`，未設定 `NEXT_PUBLIC_SYNC_URL`，與實際頁面錯誤一致。Project Overview 確認目前 Production deployment `8kTchXrDd2S3RMLy4UDu2B9BHZVN`、commit `514fa1f6648fa4bfaf69e924ca730a82f900fa84`，canonical domain 為 `editor-one-topaz.vercel.app`。
- 官方 Wrangler 4.158.0 已可執行，`wrangler deploy --dry-run --config sync/wrangler.jsonc --outdir /private/tmp/editor-s2-worker-bundle` 成功（493.81 KiB；gzip 97.29 KiB），確認 `ROOMS`／`CanvasRoom` binding 與 SQLite migration 可打包；dry-run 不代表已部署。
- 新的 CLI OAuth 已縮限為 User Read、Account Read、Workers／Worker Scripts／Worker Routes Write 及 Background Access，停在官方授權確認頁。尚未授權、尚未發布 Worker、未修改 Vercel 環境變數或觸發重新部署。

### Worker／前端部署完成後的驗收結果

- 使用者完成 Wrangler 授權後，已部署 `https://editor-canvas.yurisine7.workers.dev`，初始 code version `40220d77-a989-495e-93a1-0352077c9b7d`。設定 `ROOM_SIGNING_SECRET`（隨機值、未記錄）與同一 Supabase 專案的公開 publishable key 為 `SUPABASE_ANON_KEY` 後，目前 version 為 `f0b70c81-7020-4b45-8702-abd2aead0ef8`。未使用 service-role key。
- 在 Vercel 專案 `editor` 的 Production 補上 `NEXT_PUBLIC_SYNC_URL`，重新部署成功：deployment `CM1hTdM5uigYNrB8HiVUiYkV9h1D`，source commit 仍為 `514fa1f6648fa4bfaf69e924ca730a82f900fa84`。沒有推送本機未提交變更。
- Worker 遠端公開契約 **5/5 通過**：`GET /health` 200、合法 origin 的 CORS preflight 204、匿名 checkpoint 401、不受信任 Origin 403、偽造 WebSocket ticket 401；全部含 `no-store`，合法 origin 的 CORS 回應相符。私有結果檔 `.s2-remote/preflight.json`。最初 Node fetch 不支援手動 Upgrade header，屬測試工具限制；改用 Playwright APIRequestContext 後完成驗證，不把該錯誤列為產品失敗。
- 正式文件重新載入後已不再顯示「畫布同步服務尚未設定」，但編輯器內容消失。重複 DOM 檢查均顯示「新增節點」按鈕數為 0，畫布容器有 `data-testid="tl-license-expired"`。
- 已核對已安裝的 tldraw 5.5.2 `LicenseProvider`：正式環境未授權或授權過期時，五秒後只渲染該隱藏 marker。官方文件同樣要求有效正式網域 license key；SDK 支援自動讀取 `NEXT_PUBLIC_TLDRAW_LICENSE_KEY`，不需為此修改 SDK 或停用授權檢查。
- 使用者確認尚無 license key，需要申請試用或 Hobby 授權。**目前遠端節點操作、可靠保存、雙人協作及重啟恢復仍被授權門檻阻擋，未通過**。分享觀看者的既有畫布佔位缺口亦未宣稱解決；兩個獨立帳號 storage state 尚未保存。

授權取得後，在 Vercel Production 設定 `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` 並重新部署，確認包含實際驗收網域，再重跑 smoke／prepare／verify。官方說明：<https://tldraw.dev/sdk-features/license-key>。

### Hobby 授權生效與正式 owner 操作

- 使用者取得並在 Vercel Production 保存 Hobby license key，完成 Vercel 身分驗證後已重新部署成功：`8xQ2ksudgsZGmUa4r5AZWjDUVcFT`，source commit `514fa1f6648fa4bfaf69e924ca730a82f900fa84`。本紀錄不保存 license key。
- 在授權涵蓋的 `https://editor-gracecheng0329s-projects.vercel.app` 重新進入測試文件，超過原授權門檻時間後仍可見新增節點工具與 tldraw watermark，狀態為「已連線／已確認持久化」。正式畫布授權阻擋已解除。
- 使用已登入 owner 在正式頁面新增 `Hobby license remote smoke`，取得「已確認持久化」；改名為 `Renamed remote smoke` 並向右移動至 `x:140, y:180`，再次確認保存後重新載入。正式頁面保留相同名稱與位置，且再次顯示「已確認持久化」。這是單一 owner 的真實遠端 UI smoke，不能代替雙帳號或實例重啟測試。
- 遠端自動化測試的兩個獨立 OAuth storage states 仍未完成。首次 owner 隔離登入因 GitHub／Google 流程超過原十分鐘等待而中止，尚未保存 session；capture 工具已延長等待至一小時並重新開啟。
- 本機前端／遠端服務替代環境曾依使用者選擇準備：獨立 `editor-canvas-acceptance` Worker（初始 version `9a47df95-3fa4-4731-8878-961b5fa14016`）、獨立 secrets、精確的 `http://127.0.0.1:3103/auth/callback` 已獲使用者確認並加入。該替代環境未完成雙帳號測試；本機前端已停止，後續改回正式遠端前端驗收。
- `prepare`／`verify` 已補強為由 owner 建立節點、editor 改名及移動並建立另一節點，兩人均確認保存、同一公開 checkpoint 一致後才建立基準；重啟後驗證兩個原身分皆還原相同 records 與刪除結果。這些目前是**已備妥但未執行的驗收測試**。
