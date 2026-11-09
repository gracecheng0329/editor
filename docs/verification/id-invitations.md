# 以完整 ID 邀請（2026-11-09）

邀請維持使用穩定的 Supabase 使用者 UUID。「我的文件」直接顯示可選取複製的完整協作邀請 ID，窄畫面換行而不截斷。右上角在登出按鈕左側顯示 GitHub display name；文件編輯頁亦採用相同排列。編輯者清單顯示名稱與完整 ID。

`POST /api/docs/:id/editors` 接收 `{ "userId": "完整 UUID" }`，原 `/api/documents/:id/editors` 保留相容。名稱 payload、非 UUID 值皆回傳 422。同名使用者可透過不同 UUID 正確邀請。

先前 migration `202611090007_display_name_invitations.sql` 已在本機套用，保留其歷史；新增 `202611090008_id_only_invitations.sql` 移除以名稱邀請的 RPC，存取設定仍提供名稱供顯示。正式環境應按順序套用 migration；本次未操作遠端資料庫或部署。

驗證涵蓋短路徑的 UUID 邀請與撤銷、非擁有者拒絕、非 UUID 拒絕、同名使用者，以及兩個獨立瀏覽器 context 的邀請旅程。瀏覽器旅程確認頁面完整呈現 UUID、導覽列名稱及實際 POST body 使用 `userId`。合法本機 Auth session fixtures 不代表真實 GitHub OAuth 或遠端部署驗收。
