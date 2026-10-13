# G0 交接：最小本機驗證完成，接續 S1

日期：2026-10-12。對應總規格 v2.1、G0 #2 與下一張票 #3。本次交接不變更產品規則或 ADR 的資料權威分工，不宣稱 S1–S5 完成。

## 完成判定與證據

TV-01～TV-05 均通過，沒有尚未通過的 G0 最小驗證項目。

| 項目 | 結果與邊界 |
| --- | --- |
| TV-01 相容性 | Next.js 16.4.0、React 19.3.0、tldraw／sync 5.5.2；client-only 掛載與 Webpack production build 通過 |
| TV-02 viewer 拒寫 | 真實 Worker WebSocket；繞過 UI 的寫入由服務端丟棄，owner 重開後內容未變 |
| TV-03 同世代重連 | 獨立會話分別在線／離線新增，恢復後保留兩者並收斂 |
| TV-04 保存／快照 | 服務端權威快照加 SQL flush；隔離唯讀預覽；重建 workerd 後畫布及快照仍在 |
| TV-05 undo／世代 | 個人 undo 不撤回他人無關修改；舊票證 upgrade 被拒，仍存活頁面可下載舊畫布；還原重試不重複切換 |

先前完整六項測試通過（23.2s），TV-03／04／05a／05b 各重複三次亦通過（共十二次、52.4s）。本次交接再次執行完整六項，6 passed（26.1s），`retries: 0`。離線測試期間預期的 URI fetch 失敗不是功能失敗，也不是 AC-15 無錯誤負載驗收證據。

Lint、前端／Worker 型別檢查與 Webpack production build 已通過；預設 Turbopack 曾遇環境連接埠限制，未宣稱通過或更改預設 build 指令。完整 red／green、公開介面、環境及 AC 對照見 `docs/verification/g0-results.md`；保存／世代語義見 `docs/verification/g0-contract.md`。

## 重現入口

目前原型與文件在本地工作區；發布 issue 交接不等於 Git commit／push，也不宣稱遠端 checkout 已含本輪程式碼。測試檔為 `tests/g0/{canvas,viewer,offline,durability,undo,generation}.spec.ts`，設定為 `playwright.g0.config.ts`，Worker runner 為 `scripts/g0-worker.mjs`。

依賴安裝完成後，使用本機 Google Chrome；port 3100／8787／8788 須可用。順序執行，避免 Next dev 與 tsc 生成型別競爭：

```sh
pnpm test:g0
pnpm test:g0 offline.spec.ts durability.spec.ts undo.spec.ts generation.spec.ts --repeat-each=3
pnpm exec tsc --noEmit
pnpm exec tsc -p g0/tsconfig.json
pnpm lint
pnpm exec next build --webpack
```

Runner 產生隨機短效票證金鑰，不提供給瀏覽器；使用真實本機 Miniflare／workerd／DO SQLite，重啟沿用該輪儲存。結束只清理該輪暫存，不停止使用者的 port 3000 服務。G0 頁面只在 development 且明確啟用時開放；production 輸出為 404。

## 未完成能力的去向

| 尚未完成 | 接續票／進場限制 |
| --- | --- |
| GitHub OAuth、私密文件中繼資料、Supabase RLS／API 隔離 | #3；以正式服務驗證，不沿用 G0 身分票證 |
| 分享 token、editor 邀請及撤銷 | #4；不併入 #3，仍依原生 dependencies 進場 |
| 自訂架構節點 client／server schema、正式自動保存確認 | #5；G0 主要以內建 geo 物件驗證同步，快照早於待推送操作時仍顯示未確認 |
| 架構連線、文字與完整物件操作 | #6；補齊對應物件與綁定驗收 |
| 正式既有連線 60 秒撤權／降級 | #7；G0 不能取代正式身分與授權整合 |
| 筆畫、離線產品流程、完整 undo／redo 情境 | #8–#10；目前頁面存活及不同物件測試不代表所有競爭情境 |
| 分享者留言訂閱授權、補讀與撤權 | #11–#14；S4 前完成訂閱資格驗證 |
| 版本政策、跨服務索引／故障恢復、另存新文件／明確放棄及在線載入新世代 | #15–#18；S5 前固定重試／保留／相容政策，不能拿 G0 的 JSON 下載代替完整流程 |
| 遠端部署、適用授權、完整 OAuth／負載／展示 | 各切片 smoke test 與 #19；本輪沒有執行 500 物件／五會話負載或遠端量測 |

上述限制未改寫 G0 的 TV 通過條件，也不影響只處理登入與私密文件中繼資料的 #3；後續票仍需完成自己的驗收，不批次標記 ready。

## 追蹤狀態（2026-10-12 已回讀確認）

- 總規格 #1 保持 OPEN，body 與本地 v2.1 一致；不標為 `ready-for-agent`。
- G0 #2 為 CLOSED／completed，完成條件已勾選；移除已不適用的 `ready-for-agent`。
- #3 為 OPEN／`ready-for-agent`，移除 `needs-triage`；原生未完成 blocker 為 0，保留已完成的 #2 dependency 作為追溯。沒有勾選 S1 驗收項目。
- 其餘產品票未批次更動；沒有 commit／push 程式碼或開始實作 S1。
- 線上證據：[驗證紀錄](https://github.com/gracecheng0329/editor/issues/2#issuecomment-6126769557)、[最小契約](https://github.com/gracecheng0329/editor/issues/2#issuecomment-6126784614)、[交接快照](https://github.com/gracecheng0329/editor/issues/2#issuecomment-6126809615)。交接快照發布於結案前，最終追蹤狀態以 issue 為準。

## S1 #3 進場契約

範圍固定為故事 1–7、AC-01 中繼資料及 AC-06 API／資料隔離部分。文件分享／邀請屬 #4，畫布持久化屬 #5，既有 WebSocket 撤權屬 #7。S1 整個切片不因 #3 開始或完成就自動完成。

以下是實作前的行為契約，不表示 API 已存在；URL、Server Action／Route Handler 與內部函式名稱由實作選定。

| 操作 | 輸入與授權 | 成功輸出／效果 | 失敗 |
| --- | --- | --- | --- |
| GitHub 登入／callback | 由 Supabase Auth 完成 OAuth；驗證 callback 與安全的站內返回位置 | 伺服器可驗證的 session 與穩定使用者 ID；返回產品入口 | 取消、callback 交換失敗顯示可重試提示，不建立假 session、不洩漏憑證 |
| 取得目前身分 | 請求中的有效 session；不信任客戶端傳入 user ID | 最小必要使用者資訊，或未登入狀態 | 私密操作沒有有效身分時 `UNAUTHENTICATED`（HTTP 邊界為 401） |
| 建立私密文件 | 有效登入、非空白標題；owner 由伺服器推導 | 文件 ID、標題、owner ID、房間識別及時間；預設不分享，不接受客戶端指定 owner／分享能力 | 無效輸入 `VALIDATION_FAILED`（422）；儲存失敗不得回成功 |
| 列出自己的文件 | 有效登入；以當前使用者限制查詢 | 僅自己的文件中繼資料，無資料為空清單 | 不洩漏其他人的文件或成員 |
| 讀取文件中繼資料 | 有效登入、文件 ID；本票限 owner | 同一已保存文件的中繼資料；可開啟文件外框 | 不存在或非 owner 統一 `NOT_FOUND`（404），避免洩漏私密文件是否存在 |
| 修改標題 | 有效登入、文件 ID、非空白標題；本票限 owner | 已保存標題及更新時間；重載仍可見 | 401／404／422 依上述語義；失敗不宣告已保存 |
| 登出 | 目前 session | 清除目前工作階段；後續新請求無編輯資格 | 失敗顯示可重試狀態，不假裝已完成伺服器登出；既有畫布連線另由 #7 驗收 |

服務暫時不可用以可重試的 `SERVICE_UNAVAILABLE`（503）或等價的受控錯誤回傳，不把資料庫／憑證細節暴露給使用者。Supabase Auth 與 Postgres 仍是正式身分／產品資料來源；Document.owner_id 為唯一 owner 權威。RLS 與服務端操作都須驗權，不能只在清單 UI 過濾。

S1 的首批失敗測試：未登入建立被拒；A 建立後可列出／讀取／改名且重載保存；B 無法列出／讀取／改名 A 文件；直接資料層不能繞過限制；空白標題被拒且無新增；登出後新私密請求被拒；OAuth 失敗可重試。一般測試用合法獨立 Supabase 測試身分，不反覆依賴 GitHub OAuth；另保留一次真實 GitHub 登入 smoke test。

進場檢查：#3 原生 blocker 僅 #2；G0 最小驗證已通過，以上輸入／輸出／錯誤行為可轉成測試。#3 可在 #2 正式關閉後標記 `ready-for-agent`，不勾選任何 S1 完成項。測試環境憑證與部署 callback 尚未驗證；需要使用者配置時明確提出，不購買服務、不把測試身分後門帶入 production。
