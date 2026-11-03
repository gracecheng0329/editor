# 使用 Apple container 的 local Supabase

此環境供 S1 的真實 Auth／Postgres／RLS 整合測試使用。使用本機 Apple `container`，不依賴 Docker、Compose、Colima 或 Supabase CLI。需要 macOS 26+、Apple silicon、已安裝的 `container` 與 Node.js。

```sh
node scripts/local-supabase.mjs up
node scripts/local-supabase.mjs status
node scripts/local-supabase.mjs stop
```

啟動完成後可執行實際整合驗證：

```sh
node scripts/verify-local-supabase.mjs --restart
```

此命令會建立兩個臨時 Auth 身分與一張隨機命名的 RLS 測試表，檢查跨身分讀寫隔離、無 API key 拒絕、整組服務停止／重啟後的資料保存，以及 Studio 至 postgres-meta 的資料庫連線。結束後刪除測試表與身分；不要與另一個 `up` 同時執行。

`up` 會啟動 container 系統服務、下載 OCI 映像並建立獨立的 `editor-supabase` 網路。第一次下載較久。各服務名稱皆以 `editor-supabase-` 開頭，不管理其他容器或網路。再次執行 `up` 會重新建立無狀態服務，以更新容器重啟後的相依 IP；資料庫維持既有資料卷。`stop` 保留容器、金鑰與資料；Mac 重開後再次執行 `up`。

| 入口 | 位址 |
| --- | --- |
| Supabase API（Auth／PostgREST） | http://127.0.0.1:54321 |
| PostgreSQL | 127.0.0.1:54322 |
| Studio | http://127.0.0.1:54323 |
| Mailpit | http://127.0.0.1:54324 |

服務連接埠只綁定 IPv4 loopback。這是本機開發環境，Studio 不另設登入，email signup 自動確認。GitHub OAuth 可透過私密的 `.local-supabase/github-oauth.env` 配置專用 App client ID／secret；設定與真實登入驗收見 [S1 OAuth／部署引導](s1-oauth-deployment.md)。本環境的 email 測試身分不能當成 GitHub OAuth 驗收。

`.local-supabase/` 已加入 Git 忽略，目錄權限為 0700，產生的設定與金鑰檔為 0600（不含憑證的官方 SQL 為 0644，供容器讀取）：

- `credentials.json`：每次首次安裝隨機產生的 DB 密碼、JWT secret、anon／service role key；重啟沿用。
- `app.env`：Web app／測試需要的環境變數。不要提交或分享此檔，也不要把 service role key 放入 `NEXT_PUBLIC_*` 變數。
- 各服務的 `.env` 與 `kong.yml`：啟動設定，含本機金鑰。

需要讓 Next.js 讀取設定時，將 `app.env` 中需要的值加入本機 `.env.local`；先保留既有設定，避免整檔覆蓋。原始金鑰不會印在啟動輸出中。

資料持久保存在 Apple container named volumes `editor-supabase-data` 與 `editor-supabase-db-config`。請一併保留 `.local-supabase/credentials.json`；只刪金鑰檔不會重設資料庫密碼。腳本不提供自動清空資料命令。

## 服務範圍與來源

提供 Postgres、GoTrue Auth、PostgREST、Kong API gateway、postgres-meta、Studio 與 Mailpit。Storage、Realtime、Edge Functions、Analytics、Supavisor 不在此 S1 最小環境內；相關 API 不會假裝成功。Supabase CLI 的 `supabase start` 仍需要 Docker API，不能直接把 Apple `container` 當成 Docker CLI 使用。

Supabase 服務映像版本與角色初始化 SQL 對照官方設定 commit [`f9e0376`](https://github.com/supabase/supabase/tree/f9e0376951a1fdcc488c335ca2de4e4dc4da12e6/docker)。Gateway 採用 Kong 2.8.1 的精簡 Auth／REST 路由，而非執行完整官方 Compose；所有內部相依使用實際容器 IP，避免假設 Apple container 支援 Compose 的服務名稱解析。

Apple named volume 根目錄含 `lost+found`，因此設定 `PGDATA` 與 Postgres `data_directory` 同時指向卷內的 `database` 子目錄；首次建立時明確將映像內 `/etc/postgresql-custom` 複製到設定卷，避免依賴 Docker 的自動 copy-up。官方 `webhooks.sql` 先於 `roles.sql` 初始化，以建立角色，再設定密碼。

若啟動失敗，使用 `container logs editor-supabase-<service>` 檢查指定服務。`status` 會檢查各容器狀態及 Auth、REST、Studio、Mail 的 HTTP 健康，不代表產品 #3 的全部驗收已完成。

## 驗證紀錄（2026-10-27）

本機 Apple container CLI 1.0.0；七個服務均以 linux/arm64 執行。實際執行 `verify-local-supabase.mjs --restart` 通過：

- 兩個獨立的真實 Auth 身分可登入。
- A 透過 REST 寫入及讀回；匿名與 B 均看不到 A 的資料，B 的更新無法修改 A 的資料。
- 整組服務停止／重啟後，A 仍讀到相同已保存內容。
- 無 API key 的 REST 請求回傳 401。
- Studio 頁面可開啟，Studio 容器透過 postgres-meta 查詢到資料表資訊。
- 測試表與測試身分已清除。

專案 lint、TypeScript、Webpack production build 及既有完整 G0 測試（6 passed，29.6s）通過。第一次 G0／build 因既有 Next.js 安全更新提醒中止，重跑後通過；Next.js 16.4.0 仍輸出安全更新提醒，本次環境設定未進行框架升級。

### Standards review

獨立規範審查無可採取行動的發現；確認領域／ADR 相容、秘密檔忽略與權限、資料卷保存及服務生命週期。

### Spec review

獨立規格審查無剩餘可採取行動的發現；首次初始化的 named volume、固定資料路徑及角色建立順序問題已修正，並由上述實際啟動／重啟驗證確認。

這些結果僅完成本機服務基礎；未實作或宣稱完成 #3 的登入頁、文件功能、產品 RLS 與 GitHub OAuth smoke test。GitHub app 讀取 #3 仍回傳 404，CLI 也尚未登入。
