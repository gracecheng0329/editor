# G0 驗證紀錄

更新：2026-10-12（保留 10-11 的 TV-01／TV-02 紀錄）。**TV-01～TV-05 最小本機驗證均通過；lint 阻擋已排除，交接再次完整回歸通過。已回讀確認 [G0 #2](https://github.com/gracecheng0329/editor/issues/2) 結案、[S1 #3](https://github.com/gracecheng0329/editor/issues/3) 為 `ready-for-agent` 且未完成 blocker 為 0。**

## 實際結果

| 驗證 | 狀態 | 證據／限制 | 影響 AC |
| --- | --- | --- | --- |
| TV-01 SDK 相容與掛載 | 最小驗證通過 | Chrome 掛載 client-only 畫布並新增架構節點；本機 sync 整合及包含 sync 的 production Webpack build 通過。自訂架構節點的 server schema 尚未整合 | 所有使用畫布的 AC |
| TV-02 viewer 服務端拒寫 | 本機通過 | 真實 workerd／Durable Object SQLite；viewer 繞過唯讀 UI 發送偽造節點，服務端丟棄後本機回復，owner 重載仍只有原內容；另重複三次通過 | AC-06 |
| TV-03 同世代離線重連 | 本機通過 | A 離線新增、B 在線新增；重連後兩端保留兩個物件且內容一致，離線不宣告保存 | AC-03–AC-05、AC-11 的同步能力部分 |
| TV-04 保存與隔離快照 | 本機通過 | 指定 SQL flush 確認契約；真正 workerd 重啟後恢復已確認畫布及歷史快照，獨立預覽不污染房間 | AC-09、AC-12、AC-18 的最小能力部分 |
| TV-05 個人 undo／世代拒寫 | 本機通過 | 撤回 A 不影響 B 的無關移動；還原後舊連線停止、舊票證 upgrade 返回 409，舊頁面保留並可下載離線畫布；相同還原重試不重複切換，世代跨 runtime 保留 | AC-10、AC-14、AC-18 的最小能力部分 |

## 環境與版本

- macOS 26.5.2、arm64；Node.js 24.18.0。
- Next.js 16.4.0、React／React DOM 19.3.0、tldraw 5.5.2。
- Playwright 1.64.0、現有 Google Chrome 154.0.8037.98。
- `@tldraw/sync`／`sync-core`／`tlschema` 固定 5.5.2。
- Miniflare 4.20260730.0、workerd 1.20260730.1、esbuild 0.25.12；Worker compatibility date 為 2026-07-01。
- Next.js 與 Worker 均在本機；沒有 Cloudflare 遠端部署／區域或 Supabase 身分驗證。沒有執行 500 物件／五會話負載，沒有 SLA 或收斂時間量測結果。

## Red → green

### TV-01

`tests/g0/canvas.spec.ts` 經 Next.js 頁面的可觀察介面驗證。

1. Red：未建立 `/g0` 時，等待「G0 同步驗證」標題失敗，1 failed（不是將依賴安裝錯誤當 red）。
2. Green：建立僅 development 且須 `G0_ENABLED=1` 的 client-only 頁面；Chrome 掛載並點擊「新增節點」後，物件數為 1，1 passed（5.0s）。
3. 無房間參數時仍是本機掛載測試；有房間及測試票證時才連接同步服務。不顯示已雲端保存，也不提供登入／發票證後門。

### TV-02

`tests/g0/viewer.spec.ts` 使用獨立 owner／viewer browser contexts，透過 `/g0` 及真實 Worker WebSocket 驗證；不 mock 合併，也不斷言 SDK 私有訊息格式。

1. Owner 新增標記為 `OWNER-TV02` 的物件；viewer 透過同步看見同一物件。
2. Viewer 透過僅 G0 提供的測試按鈕呼叫公開 `editor.store.put()`，繞過 editor 唯讀操作限制，新增 `FORGED-TV02` 物件。Playwright 的 `framesent` 事件確認包含該標記的資料確實離開瀏覽器。
3. Red：同步連線未設定服務端 `isReadonly` 時，偽造修改送出後物件數持續為 2，斷言原有 1 個物件失敗，1 failed（13.4s）。環境啟動／早期接線錯誤不計為 red。
4. Green：Worker 驗證 HMAC 票證後，以 `TLSocketRoom.handleSocketConnect({ isReadonly: claims.role === "viewer" })` 建立連線。SDK 丟棄 viewer 修改，viewer 畫布回復原內容；owner 重載後仍只有 `OWNER-TV02`，viewer 顯示唯讀且正常新增按鈕停用。
5. TV-01＋TV-02 回歸：2 passed（8.0s）。TV-02 額外連續三次通過（14.8s），沒有重試掩蓋失敗。

公開介面：`useSync`、`Editor.store.put()`、`TLSocketRoom.handleSocketConnect` 的 `isReadonly`、`SQLiteSyncStorage`、`DurableObjectSqliteSyncWrapper` 及瀏覽器 WebSocket 事件。

限制：只驗證內建 `geo` 物件的新增拒寫。測試票證取代正式登入／分享授權，不能當作 AC-06 的完整產品驗收；未驗證撤權、過期、錯誤簽名、跨文件攻擊、所有物件類型或 Supabase RLS。Owner 重載不是 runtime 重啟，亦不是 TV-04 的可靠保存證據。

### TV-03

`tests/g0/offline.spec.ts`：以 Playwright 的真實 WebSocket passthrough 關閉當前傳輸並阻止重連，同時將該 context 設為 offline；不 mock SDK 合併。A 的頁面仍存活，離線新增 `OFFLINE-A`，B 在線新增 `ONLINE-B`。恢復傳輸後，兩端內容均為 `OFFLINE-A,ONLINE-B`，物件數為 2；連線恢復與收斂分別採 10 秒／5 秒限時斷言，不以固定 sleep 判定成功。

- Red：缺少「新物件標記」操作入口，1 failed（45.0s）。
- Green：加入標記輸入與離線狀態，保留 `useSync` 的原生合併，1 passed（8.4s，含啟動）。
- 公開介面：`useSync`、`Editor.createShape()`、Playwright WebSocket route／browser context 網路控制。
- 限制：兩個獨立會話、不同物件新增；不代表同物件競爭、筆畫、撤權重連、關頁後恢復或遠端網路驗收。

### TV-04

`tests/g0/durability.spec.ts`：建立並確認 `BEFORE-SNAPSHOT` 快照，繼續加入 `AFTER-SNAPSHOT`。獨立唯讀預覽仍只呈現前者，而兩個在線畫布均保留兩者；新修改令先前保存狀態失效。再次確認完整畫布後，關閉瀏覽器會話，由 Node 控制器 dispose 原 Miniflare 並建立新的 workerd，沿用相同 SQLite 目錄；重新開啟後恢復兩個物件，兩份歷史快照也可經公開 HTTP 讀取，修訂非零且世代為 0。

- Red：缺少「建立權威快照」入口，1 failed（45.0s）。
- Green：新增服務端快照、SQL flush 確認、獨立預覽與真實 runtime 重啟，1 passed（10.4s，含啟動）。
- 公開介面：`SQLiteSyncStorage.getSnapshot()`、`DurableObjectStorage.sync()`、`Tldraw.snapshot`、`Miniflare.dispose()`；具體 HTTP 確認語義見 [G0 最小契約](g0-contract.md)。
- 邊界發現：HTTP 快照可能早於 SDK 的待推送操作到達。UI 只有在回應快照涵蓋目前 document records 時才顯示確認，否則保持「尚未確認保存」；G0 手動再次確認，正式自動確認策略留給 S2。
- 限制：本機正常 flush／正常 runtime 停止與重建，不是強制斷電或遠端容錯證據；未包含所有物件類型、Postgres、留言或保存故障注入。

### TV-05

`tests/g0/undo.spec.ts`：A 移動物件 A，B 移動物件 B；兩端看見兩次移動後，A undo。兩端皆恢復 A 的原位置，B 的移動仍存在，物件數不變。

- Red：缺少「移動標記物件」入口，1 failed（13.6s）。
- Green：以 `Editor.markHistoryStoppingPoint()` 分隔本機操作，使用 `Editor.updateShape()`／`undo()`，1 passed（8.3s，含啟動）。沒有自行維護第二套協作 undo 引擎。

`tests/g0/generation.spec.ts`：三個獨立會話，C 在世代 0 離線新增 `PENDING-OLD`，owner 與在線會話確認 `PRE-RESTORE` 修改後，owner 還原 `RESTORE-TARGET` 快照。

- Red：對已同步的前置資料呼叫還原介面返回 404，而非預期 200，1 failed（5.0s）。早期確認快照與推送競爭不算世代測試的 red，已獨立記錄於 TV-04 邊界。
- Green：同一 DO SQLite transaction 切換畫布、世代與操作結果；停止舊連線。C 重連時顯示衝突且保留原畫布，下載的 JSON 包含完整 document snapshot、來源文件、世代 0 與 `PENDING-OLD`。直接使用舊票證的 WebSocket upgrade 返回 `409 GENERATION_MISMATCH`；新世代會話只見還原目標，相同操作 ID 重試返回原結果，還原前快照仍可讀。再次重啟 workerd 後，新世代票證及畫布仍有效。1 passed（12.7s，含啟動）。
- 公開介面：`TLSocketRoom.loadSnapshot()`、`closeSession()`、`handleSocketMessage()`，DO SQL transaction／flush、`useSync` async `uri`、`Editor.store.getStoreSnapshot()` 及 HTTP／下載內容。
- 限制：保留完整舊畫布而非精確差異；正式另存新文件、明確放棄流程及在線會話自動換票證／載入仍待 S5。未測同一物件互斥修改的 undo、還原中崩潰、flush 失敗、Postgres 索引補寫或保留清理，不能宣稱完整 AC-10／AC-18 或 S5 完成。

### 2026-10-12 回歸

完整 TV-01～TV-05 共六項測試，6 passed（23.2s）。另將 TV-03／TV-04／TV-05a／TV-05b 各重複三次，12 passed（52.4s）；兩輪均 `retries: 0`。本機主動斷網期間 SDK 可輸出預期的 URI fetch 失敗／重試訊息；沒有將這些訊息當作功能成功證據，也沒有執行 AC-15 的無錯誤負載驗收。

2026-10-12 正式交接再跑完整六項，6 passed（26.1s），`retries: 0`；十二次重複驗證沿用上述結果，本次未再重複執行。未改應用程式或測試邏輯。

## 其他檢查

- 開始工作時的原有程式碼：型別檢查及 lint 通過；`next build --webpack` 通過（4.7s 編譯），此結果不包含後來的 G0 頁面／sync 整合。
- 預設 Turbopack build 重試後仍因子程序綁定連接埠遭拒而失敗。Webpack 是已實測的替代 build 路徑，沒有修改預設 build 指令或宣稱 Turbopack 通過。
- 加入同步 harness 後：全專案 ESLint、`git diff --check`、標準 `tsc --noEmit` 及 `tsc -p g0/tsconfig.json` 曾通過。Worker 使用獨立型別環境，不把 Cloudflare globals 混入 Next.js。
- 10-11 的 lint 因額外變動的 `pluginQuery` 未定義而失敗。10-12 初次重跑缺少 `@eslint/js`；使用者安裝後改為因缺少 `globals` 失敗（exit 2），另有多個無法解析的直接 plugin imports。後續依使用者要求整理為 Next.js 設定：沿用 `eslint-config-next/core-web-vitals` 與 `typescript`，保留 `@eslint/js` recommended，移除 Vite React Refresh、重複 React／Hooks／TypeScript 與未使用的 Query／unused-imports 插件設定，不新增這些依賴。排除產物及 `.agents` 工具範本，保留 TypeScript 未使用變數與外連安全檢查。
- 整理後 `pnpm lint`（`eslint . --max-warnings=0`）、前端與 Worker 型別檢查、`git diff --check` 均通過。另以 ESLint 公開 API 確認 Next.js 規則生效、沒有 Vite／Query 插件、產物被排除；記憶體內錯誤範例確實觸發未使用變數與不安全外連的 error。此輪只改設定與紀錄，沒有重跑瀏覽器測試，以上六項及重複測試結果沿用前一輪。
- 10-12：標準前端與 Worker 型別檢查均通過。曾在 Next dev 重新產生 `.next-g0` 型別時並行執行 tsc 遇到暫存檔消失；服務結束後順序重跑已通過，不修改型別設定掩蓋競爭。
- 包含 TV-03～TV-05 的 `next build --webpack` 通過（2.7s 編譯）；ESLint 整理後再次通過（2.7s 編譯）。預設 Turbopack build 的既有環境限制沒有在本輪重新驗證。
- Production build 的 `.next/server/app/g0.meta` 記錄 status 404，G0 測試頁面未在正式輸出開放。
- `next dev` 自動加入 AGENTS.md 的 Next.js 指引，以及 tsconfig 的 `.next-g0` 型別路徑；測試使用獨立暫存目錄，未停止使用者原本在 port 3000 執行的開發伺服器。

## 重現方式與剩餘門檻

本輪獲授權後已下載並連結 runtime 與測試依賴，workerd health check 實際回傳 `runtime-ok`。pnpm 最初因未批准 esbuild／workerd lifecycle scripts 回報 ignored-builds；現明確設為 false，使用已安裝的原生 optional packages，沒有執行該兩套件的安裝腳本。`pnpm install --offline --frozen-lockfile --lockfile-only` 通過，lockfile 與依賴宣告一致。

需本機 Google Chrome，且 port 3100／8787／8788 未被占用。依賴就緒後順序執行（避免 tsc 與 Next dev 生成型別互相競爭）：

```sh
pnpm test:g0
pnpm test:g0 offline.spec.ts durability.spec.ts undo.spec.ts generation.spec.ts --repeat-each=3
pnpm exec tsc --noEmit
pnpm exec tsc -p g0/tsconfig.json
pnpm lint
pnpm exec next build --webpack
```

測試啟動本機 Worker、Node-only 重啟控制器與獨立 `.next-g0` 開發伺服器，測試結束即停止；SQLite 於該輪重啟之間保留，整輪結束才清理本輪暫存，不刪除使用者資料。票證金鑰不下發瀏覽器。`/g0` 頁面僅 development 且 `G0_ENABLED=1` 可進入。

TV-01～TV-05 的最小本機證據支持沿用既有技術路線，並補上 [保存／世代契約](g0-contract.md)，沒有更改產品規則。Lint 設定阻擋已排除，總規格／CONTEXT 已同步本機驗證狀態；[G0 交接](g0-handoff.md) 指定剩餘能力的接續票與 #3 進場契約。2026-10-12 已發布結果、契約與交接至 #2，回讀確認總規格 #1 與本地 v2.1 內容一致、#2 CLOSED、#3 OPEN 且 `ready-for-agent`，#3 原生未完成 blocker 為 0。保留 dependency #2 作為追溯，沒有刪除依賴；S1 驗收項目未勾選，其餘產品票未批次解除門檻。程式碼與文件尚未因發布 issue 而自動 commit／push。這些測試不等於正式產品 AC 全部通過。

計畫與官方公開介面參考見 [G0 驗證計畫](g0-plan.md)。任何 SDK 能力不符，須提出具體限制與替代契約並取得使用者決策，不能自行更改已確認的產品行為。
