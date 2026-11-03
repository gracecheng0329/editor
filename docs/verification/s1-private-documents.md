# S1 #3：私密文件本機驗證

本頁記錄 **2026-10-28 的 #3 階段**，當時僅處理登入與私密文件中繼資料，未加入分享或 editor 資格。後續 2026-10-30 已完成 #4 的本機程式與測試，包含分享／邀請、owner／editor／viewer 存取；目前完整契約與結果見 [S1 分享與編輯者驗證](s1-sharing.md)。以下 owner-only 契約與六項測試結果保留作為 #3 歷史紀錄，不代表目前不支援 editor 讀取。2026-11-03 已配置本機 GitHub OAuth 並通過真實登入／建立／改名／重載／登出 smoke，見 [OAuth 驗收紀錄](s1-oauth-deployment.md)。遠端部署與必要角色旅程 smoke 尚待驗證，#3／#4 仍未結案。

## 重現

先依 [local Supabase](local-supabase.md) 啟動七個真實本機服務，再執行：

```sh
pnpm db:migrate:local
pnpm test:s1
```

預設從 repo 的已忽略 `.local-supabase/credentials.json` 讀取本機測試憑證；獨立 worktree 可設定 `S1_CREDENTIALS_FILE` 指向該檔。service role key 只用於測試身分建立與清理；產品只使用 anon key 與使用者 session。測試需要 Chrome、port 3101，Next 產物在已忽略的 `.next-s1/`。Auth 專用 suite 另可用 `playwright.s1-auth.config.ts`（port 3102）執行。

`db:migrate:local` 僅針對 Apple container 的 `editor-supabase-db`，不接受遠端目標、不 reset 資料。依檔名排序，以 transaction、advisory lock 與 checksum ledger 執行未套用 SQL；已套用檔案變動會拒絕。初始 SQL 可接續本輪開發已存在的 documents 表，不刪文件資料。本次連續執行兩次均成功。

## 公開契約

`POST /api/documents` 建立；`GET /api/documents` 列出 owner 文件；`GET /api/documents/:id` 讀取；`PATCH /api/documents/:id` 改名。成功直接回傳中繼資料物件或清單；錯誤為 `{ "error": "CODE" }`，未登入 401、非 owner／不存在 404、無效標題／JSON 422、跨 origin 寫入 403、服務失敗 503。標題 trim，owner 從伺服器驗證的 session 推導；不展開客戶端 payload。

RLS 分別限制 select／insert／update 為 owner。authenticated 只有 select、insert(owner_id,title)、update(title)，不可透過 REST 修改房間、owner、文件 ID 或時間；沒有 authenticated delete。系統欄位由 DB default／trigger 產生。

## TDD 與證據邊界

先前實作者紀錄：未登入建立測試先收到 404，加入 route 後為 401；owner 建立先收到 401，加入真實 session／資料層後為 201。接手後 API／直接 REST 測試實跑 2 passed（9.1s），包括房間欄位不可覆寫。接手時 narrowed grants 已存在於 DB，沒有再次宣稱該硬化的 red 已重現。

瀏覽器首次真實建立回傳 403，測試期待 201：Next 的 request URL hostname 正規化與瀏覽器 Host 不一致。以 incoming Host 與 request protocol 比較 Origin 後，建立與改名均回成功；同樣保護登出。`/documents` 的 Supabase SDK 讀取時鐘另觸發 Next prerender 診斷，明確等待 request connection 後修正。

沒有記錄 OAuth 成功路徑先紅後綠；取消／無效 callback 的本機測試不能取代 provider smoke test。Next 16.4.0 持續顯示既有安全更新提醒；本輪未升級框架。

核心 browser journey、完整 suite 及整體 lint／build 的最終執行結果由整合紀錄補充；不以本文件的契約描述代替通過證據。

## 本輪整合結果

- 完整 S1 suite：6 passed（11.8s），包含三個 OAuth 失敗／來源驗證情境、兩個 API／RLS 情境及瀏覽器建立／改名／重載／登出旅程。
- 登出後直接 REST 重送舊 JWT 的測試先失敗：原本仍改成 `Direct REST replay`。套用 migration 002，以 JWT session_id 對照目前有效 Auth session 後，同一測試返回空集合，完整 suite 通過。應用程式 API 對舊 cookie 返回 401。
- TypeScript、受影響檔案 ESLint 及 diff whitespace 檢查通過。完整專案檢查與 production build 留待整個 S1 整合完成後執行。
- Next 升級提示曾中止測試服務；該次 connection refused 不算行為失敗測試。依提示重試後取得上述實際通過結果。
