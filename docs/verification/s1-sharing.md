# S1 分享與編輯者存取（#4）

實作範圍是故事 8–14 的存取與身分部分、AC-02 存取、AC-06 產品 API／資料層及 AC-11 新請求。畫布閱讀／唯讀寫入拒絕屬 S2，既有 WebSocket 撤權屬 #7，留言／訂閱屬 S4。本頁不宣稱上述跨切片 AC 全部完成。

## 公開契約

| 操作 | 資格與結果 |
| --- | --- |
| `GET /api/documents`、`GET /api/documents/:id` | 有效登入的 owner／受邀 editor；回應包含服務端推導的 `role`。無閱讀資格與不存在的文件同為 404；未登入為 401。 |
| `PATCH /api/documents/:id` | 僅 owner 修改標題，editor 直接 REST 更新也被 RLS 拒絕。 |
| `POST /api/documents/:id/share` | owner 產生／輪替分享連結。資料庫生成 32 位元組密碼學亂數，回傳一次 token。輪替立即使舊 token 失效。 |
| `DELETE /api/documents/:id/share` | owner 撤銷分享，可重複操作；不影響 owner／有效 editor。 |
| `GET /api/documents/:id/editors` | owner 取得 enabled 與 editor ID 清單，不回傳 token 或 hash。 |
| `POST /api/documents/:id/editors` | owner 提供 `{userId}`，授予已註冊 GitHub 身分 editor 資格；重複授予不重複建立關聯。 |
| `DELETE /api/documents/:id/editors/:userId` | owner 立即撤銷 editor。原 editor 之後只有持有效分享 token 才能以 viewer 讀取。 |
| `POST /api/share/resolve` | 匿名／已登入使用者提供 `{token}`；有效時僅回傳 `{id,title,role:'viewer'}`。無效／撤銷 token 統一 404。每次請求重新驗證，不核發可越過撤權的長效資格。 |

其他輸入錯誤為 422；已授權操作的基礎服務失敗為可重試 503；跨來源變更請求為 403。不將 room ID、已登入或分享已啟用當作觀看資格。

## 身分與儲存

「我的文件」顯示使用者自己的 **協作邀請 ID**（Supabase 穩定使用者 UUID）。收件者先完成 GitHub 登入，再複製給 owner。此 ID 不是 GitHub 數字 ID 或帳號名稱。受控資料庫操作查證 `auth.identities.provider = 'github'`；不信任 `user_metadata`，不公開搜尋使用者目錄、不使用 email 邀請、不產生第二位 owner。

分享 hash 與唯一 `(document_id,user_id)` editor 關聯存於未公開的 `private` schema；匿名與 authenticated 均無直接 table 權限。分享 token 僅保留 SHA-256 hash。資料庫操作使用固定空 `search_path` 的 SECURITY DEFINER、完整 schema 名稱、撤回 PUBLIC execute，再授予最小角色。管理操作同時查證 owner 與目前 JWT 的有效 Auth session，阻擋登出後仍未到期的 JWT。editor 讀取採獨立受控 predicate，避免循環 RLS。

觀看連結格式為 `/share#TOKEN`。fragment 不送入 HTTP URL 或 referrer；頁面以同來源 POST body 驗證，普通文件／存取設定讀取不包含 token。Proxy 對產品回應採 private/no-store。正式請求不使用 service-role 金鑰；測試的 admin／SQL 只用於隔離資料與可信 GitHub identity fixture 建立／清除。

## 本機重現與示範

1. 依 [本機 Supabase](local-supabase.md) 啟動服務；設定 `NEXT_PUBLIC_SUPABASE_URL` 與 anon key。
2. 執行 `node scripts/migrate-local-supabase.mjs`。runner 以交易與 checksum 保存已套用 migration，不修改既有資料；003 後的 004 改由資料庫產生 token，005 加入 editor 權限。
3. 執行 `S1_CREDENTIALS_FILE=/absolute/path/credentials.json node node_modules/@playwright/test/cli.js test --config playwright.s1.config.ts`。預設 credentials 為 `.local-supabase/credentials.json`，本機正式頁面測試使用 port 3101 與 `.next-s1`。
4. 真實 GitHub provider 配好後，以兩個獨立 GitHub 帳號／browser contexts 開啟 `/documents`，B 複製協作邀請 ID 給 A；A 建立文件、授予 B，B 從自己的文件清單開啟並看到編輯者身分。A 產生觀看連結交給第三個匿名 context，看到觀看者・唯讀身分及最小中繼資料。
5. A 撤銷 B，B 重新開啟原文件應拒絕；若另持有效連結可降為 viewer。A 撤銷分享，匿名 viewer 重新驗證應拒絕，owner／未撤權 editor 保持存取。

2026-10-30 本機全套 S1 **11 passed（41.5s）**，包含原 #3 六項、#4 一項獨立 browser contexts 核心旅程與四項真實 API／Data API／RPC 測試。覆蓋私密預設、最小 viewer metadata、token 不外洩、直接 RPC 不能指定 token、輪替／撤銷、重複 grant 唯一性、GitHub 身分查證、metadata 偽造拒絕、跨文件隔離、editor 禁止管理標題／權限、分享撤銷保留身分存取，以及登出後舊 JWT 的 RPC 拒絕。TypeScript、整個工作樹 lint 與 Webpack production build 均通過；build 列出全部正式分享／editor 路由。

失敗先行證據依序為：分享 POST 尚不存在時 expected 200／actual 404；直接 RPC 可指定 token 時 expected error／actual null；editor 路由未存在時 expected 422／actual 404；正式頁尚未顯示協作邀請 ID 時 locator 不存在。最小實作後由上述全套驗證通過。其餘資安邊界測試是額外回歸覆蓋，不宣稱每項都曾失敗。

整合測試用獨立合法 Auth sessions 與測試資料庫可信 GitHub identity fixtures；這不是實際 GitHub OAuth 成功證據。真實 OAuth 與必要部署 smoke 尚未配置／執行，#3／#4 保持未結案。已知 Next dev／build 有間歇性 security upgrade advisory 中斷，依指示重跑；這屬工具啟動阻斷，不列為產品行為 red，不升級／修改框架來掩蓋結果。
