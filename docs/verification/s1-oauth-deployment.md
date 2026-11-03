# S1 真實 OAuth 與部署驗收

本文件補上 #3／#4 最後的設定與驗收路徑。**設定引導、preflight、真實 OAuth smoke 是三種不同證據**；未取得最後一項前，維持 PR draft 與票券未結案。

## 本機 GitHub OAuth

本機 Apple container 的 Auth 沒有可用於修改 provider 的託管 dashboard；設定由啟動腳本傳入 GoTrue。

1. 在 [GitHub OAuth Apps](https://github.com/settings/applications/new) 建立本機專用 App：Homepage `http://127.0.0.1:3000`；Authorization callback `http://127.0.0.1:54321/auth/v1/callback`。這是 **Supabase Auth callback**，不是 Next.js 的 `/auth/callback`。不啟用 Device Flow。
2. 用本輪互動引導保存 Client ID／新產生的 Client secret；或自行建立 Git 忽略的 `.local-supabase/github-oauth.env`，權限設為 `0600`：

   ```dotenv
   GITHUB_CLIENT_ID='your-client-id'
   GITHUB_CLIENT_SECRET='your-client-secret'
   ```

   secret 只交給本機 GoTrue，不放進 `NEXT_PUBLIC_*`、聊天、提交或 GitHub Actions。
3. 執行 `node scripts/local-supabase.mjs up`，再執行 `pnpm db:migrate:local`。`up` 重新建立無狀態服務並保留 DB 資料卷；已登入使用者會受到短暫服務中斷。設定檔不存在時 provider 預設關閉；不完整、格式錯誤或非私密權限的檔案會在重啟服務前被拒絕。
4. `.env.local` 只需要 `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321` 與本機 `NEXT_PUBLIC_SUPABASE_ANON_KEY`，從已忽略的 `app.env` 取得；不要複製 service-role key。保留既有其他設定。此輪已準備這兩個公開值，檔案權限 `0600`。
5. 執行 `pnpm dev`，固定使用 `http://127.0.0.1:3000`。若 port 3000 已占用，先停止既有 server；改 port 必須同步精確的 Auth redirect allow-list。
6. 執行設定檢查：

   ```sh
   node scripts/s1-preflight.mjs http://127.0.0.1:3000 http://127.0.0.1:54321
   ```

   此工具檢查首頁、匿名文件清單的 401、取消登入的重試返回、PKCE／產品返回網址及 GitHub 的 Auth callback。它停在 GitHub 授權頁前，不輸入登入資料、不交換 code、不建立文件；不能驗證 client secret 是否有效、真實 session 或完整產品行為。輸出不包含 OAuth URL、state、code 或 cookie。

## 全新 Supabase／Vercel 專案

本輪只準備引導，沒有建立、購買或部署遠端服務。遠端不能使用本機 `127.0.0.1` Supabase；不要將本機 service-role／JWT secret 複製到託管專案。

1. 在 [Supabase Dashboard](https://supabase.com/dashboard) 建立專用專案。由 Connect 或 Settings → API Keys 取得 project URL 與公開 publishable／legacy anon key；資料庫密碼保留於密碼管理器。
2. 建立遠端專用 GitHub OAuth App，callback 為 `https://<project-ref>.supabase.co/auth/v1/callback`。在 Authentication → Sign In / Providers → GitHub 啟用 provider，直接填入 Client ID／secret 並儲存。
3. **僅對全新且未套用 S1 的專案**，在 SQL Editor 依序一次套用 `supabase/migrations/` 的六個 SQL 檔，整批包在同一個 transaction。此輪已準備本機 bundle `.local-supabase/s1-initial-migrations.sql`，供引導使用。SQL 錯誤即停止；既有資料庫先交由 agent 檢查 migration 狀態，不能重跑 bundle 或刪除資料重來。本機 migration runner 刻意不支援遠端。
4. 依 `CONTEXT.md` 確認適用的 tldraw 授權，再到 [Vercel New Project](https://vercel.com/new) 匯入 `gracecheng0329/editor`。Framework 為 Next.js，root 為 repo 根目錄，build command 使用 `pnpm exec next build --webpack`。設定部署環境（至少 Preview）的兩個公開變數：

   ```text
   NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
   ```

   Next.js 不需要 GitHub client secret 或 Supabase service-role key。公開變數在 build 時固定；變更後要重新部署。
5. 到專案 Deployments → Create Deployment，指定 `codex/s1-integration`；核對部署 commit 包含本輪修改。不要用仍是舊程式的 `main` 部署作 S1 驗收。使用此部署的固定 HTTPS 網址，避免測試中 alias 指向另一提交。若 Vercel Deployment Protection 阻擋匿名工具，記錄為未驗證，改由已授權 browser contexts 驗收；不要將保護頁誤判為產品成功。
6. 在 Supabase Authentication → URL Configuration 設定 Site URL 為固定產品 origin；Redirect URLs 加入精確的 `https://<app-origin>/auth/callback`。這是 **產品 callback**；GitHub 的 Supabase callback 保持不變。遠端 OAuth App 的 Homepage 更新為產品 origin。
7. 將部署 origin 與 Supabase origin 交給 agent，執行 `node scripts/s1-preflight.mjs https://<app-origin> https://<project-ref>.supabase.co`，再執行下列真實 smoke。

## 真實 browser smoke 與完成判準

使用兩個獨立 browser contexts／真實 GitHub 帳號 A、B，及一個匿名 context C。使用者自行完成 GitHub 密碼、2FA 或 consent；不匯出 storage state、cookie、provider token 或錄製登入憑證。

1. A 從產品入口登入，實際經 GitHub → Supabase → 產品 callback 返回「我的文件」。建立、列出、重新開啟、改名並重載，確認保存。
2. B 獨立 GitHub 登入；邀請前不能讀取 A 的私密文件。B 複製協作邀請 ID，A 授予 editor，B 可從自己的清單開啟並看到編輯者身分，不能管理標題／分享／邀請。
3. A 產生分享連結，C 以 viewer 唯讀身分讀到最小中繼資料。輪替後舊連結拒絕；撤銷後新請求拒絕，但 A 與未撤銷 editor 的身分存取仍有效。
4. A 撤銷 B，B 的後續文件讀取被拒；另持有效分享 token 時只能降為 viewer。
5. A 登出，後續私密 API 為 401、重新開啟文件要求登入。舊 JWT 直接 API／RPC 的失效已由本機回歸測試覆蓋；若需遠端重送驗證，由 agent 使用暫存記憶體處理，不能把 cookie 或 token 貼到聊天／文件。

證據記錄日期、部署 commit／origin、各角色步驟與實際結果。全部通過後才能更新 #3／#4 驗收與 PR ready 狀態；畫布內容與既有 WebSocket 撤權仍由 S2 驗收。

## 工具回歸與證據限制

```sh
node --test scripts/test-local-github-oauth.mjs scripts/test-s1-preflight.mjs
```

這些測試使用私密暫存檔與隔離 HTTP fixture，驗證設定載入、憑證拒絕、PKCE／callback 檢查、錯誤 provider 與錯誤匿名授權的偵測。不是外部 GitHub OAuth 或 Vercel 成功證據；不宣稱每一項都有失敗先行紀錄。

2026-11-03：使用者已透過私密引導設定本機 OAuth App，Auth 重啟與七項服務健康檢查成功，五項真實本機 preflight 通過；瀏覽器已到達 GitHub 真實登入頁。原有 S1 回歸 **12 passed（29.0s）**，新增三項工具測試與全專案 lint 通過。preflight 的無效 JSON 保密回歸先實際失敗（錯誤包含 fixture 回應片段），轉成受控錯誤後同一測試通過。首輪 S1 測試曾被 Next 啟動提醒中止，連線拒絕不列為產品 red；重跑後取得上述通過結果。本輪未修改應用程式或 SQL，沒有重跑 production build。真實登入成功與遠端部署 smoke 仍待獨立記錄。

官方依據：[GoTrue 自架設定](https://supabase.com/docs/guides/self-hosting/auth/config)、[GitHub provider 設定](https://supabase.com/docs/guides/auth/social-sign-in/auth-github)、[Vercel Git 部署](https://vercel.com/docs/git)。Next.js 環境變數與部署行為另已對照本機安裝版本的 `node_modules/next/dist/docs/`。
