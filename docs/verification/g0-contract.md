# G0：保存、快照與世代的最小契約

日期：2026-10-12。這是本機技術驗證契約，不是 S2／S5 產品 API 完成證據；測試結果見 [G0 驗證紀錄](g0-results.md)。

## 存取與公開介面

Worker 只在本機 `127.0.0.1:8787` 執行，接受來源 `http://127.0.0.1:3100`。所有文件操作須帶 Node 測試端簽發的短效票證，限定文件、角色與世代；不對瀏覽器提供簽名金鑰，也不提供發票證入口。

| 操作 | 輸入 | 成功結果／限制 |
| --- | --- | --- |
| `GET /rooms/:room/session` | 有效票證 | `{ generation }`；重連前驗證，不能據此宣稱保存 |
| WebSocket `/rooms/:room` | 有效票證、SDK sessionId | viewer 由 SDK 服務端拒寫；每個 frame 在交給 SDK 前再驗到期、有效世代及還原狀態 |
| `POST /rooms/:room/snapshots` | owner／editor 票證；不接受客戶端畫布 | 返回伺服器產生的快照、不可變 ID、世代、修訂與標記；先等待 SQLite flush |
| `GET /rooms/:room/snapshots/:id` | 目前有效票證 | 讀取已保存快照，包含其原世代；不能讀取別的房間 |
| `POST /rooms/:room/restore` | owner 票證及 `{ versionId, operationId }` | 返回 `{ operationId, generation, preRestoreId }`；同操作 ID 與相同版本重試返回原結果，不再切換 |

未授權票證返回 401，角色不足返回 403，未知版本返回 404。世代不符返回 409 與 `{ code: "GENERATION_MISMATCH", generation }`；還原忙碌返回 503，可稍後重試。相同 operation ID 配不同版本返回 409。這不是正式 Supabase 身分、分享撤權或跨服務錯誤契約的替代品。

## 何時算確認保存

從 `SQLiteSyncStorage.getSnapshot()` 同步擷取服務端已接受的文件 records、schema 及 `documentClock`，保存快照後等待 `ctx.storage.sync()`，才回傳成功。此確認只涵蓋回應中的世代與修訂，不涵蓋尚未抵達伺服器的操作，也不因 WebSocket online／發送完成而成立。

UI 比對目前公開 document records 與確認快照。相同且連線健康才顯示「已確認持久化」；新增／移動後若不一致即回到「尚未確認保存」，離線則顯示「離線／待同步」，請求失敗顯示「保存失敗」。快照早於推送時保持未確認，G0 需再次手動確認；自動確認／重試策略留給 S2。

Cloudflare 文件將 `sync()` 定義為等待待寫資料落盤；本機驗證另透過真正 dispose／重建 Miniflare workerd，使用相同 SQLite 路徑重新讀取，確認不是僅存活分頁的記憶體資料。[SQLite Storage API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#sync)

## 預覽與還原

預覽以獨立、唯讀的 `Tldraw` store 載入權威快照，不連接任何協作房間。測試同時核對預覽內容與另一個在線會話，避免用在線 store 載入舊版本。

還原先拒絕新的畫布 frame，再保存並 flush 還原前快照。隨後以同一 DO SQLite transaction 切換畫布、增加世代並記錄操作結果，停止舊連線，flush 後返回成功。`TLSocketRoom.loadSnapshot()` 僅用於服務端這一步，不用在在線預覽；世代由 DO SQL 記錄唯一決定，不由瀏覽器或 Postgres 索引決定。[Cloudflare transactionSync](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/#transactionsync)

本輪驗證正常還原、相同請求重試、還原前快照可讀與重啟後有效世代保留。未注入落盤失敗、切換中崩潰或 Postgres 索引失敗，不能宣稱完整 AC-18 通過。

## 舊世代與本機內容

使用 `useSync` 公開的 async `uri` 在每次重連前檢查 `/session`。收到 409 時，不回傳舊世代 WebSocket URI，暫停該次連線嘗試，將仍存活 editor 的完整 document snapshot 保留並凍結為唯讀，顯示衝突提示且可下載 JSON。離開頁面由 SDK cleanup 關閉 adapter。[useSync](https://tldraw.dev/reference/sync/useSync)

保留內容是完整舊畫布，包含已保存基底與本機待同步修改，不是差異補丁；不自動送進新世代。下載不表示已另存為服務端新文件，重新載入／關閉舊頁面前仍應下載。正式另存文件、明確放棄、換發票證及在線協作者自動載入新世代尚待 S5 整合。

這個 preflight 是保留內容的客戶端保護，不是授權機制。繞過 preflight 的舊票證仍會被 Worker 的 handshake／逐 frame 世代檢查拒絕。TV-05 另直接送出舊世代 WebSocket upgrade，驗證返回 409，並以新票證核對新畫布沒有舊離線物件。

## 測試儲存與控制器

Node runner 使用 `mkdtemp` 建立本輪專用 SQLite 目錄；重啟 workerd 時沿用，整輪測試結束才刪除本輪暫存。Node-only 的 `POST 127.0.0.1:8788/restart` 須帶未下發瀏覽器的測試金鑰，不是 Worker 路由，也不是 production 管理入口。

G0 的版本及操作結果暫存於 DO SQL，僅為驗證快照、原子切換與跨 runtime 保存。正式版本快照／索引與產品資料仍依 ADR-0002 整合 Supabase Postgres；本原型沒有第二個畫布同步引擎，也未更改資料權威分工。
