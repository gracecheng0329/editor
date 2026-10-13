# G0 驗證計畫

沿用使用者已確認的測試介面：獨立 browser contexts 透過 Next.js 頁面操作真實同步服務，另透過直接 WebSocket／HTTP 請求驗證未授權行為。不 mock 同步合併，不斷言 SDK 私有訊息格式。

| 測試介面 | 可驗證 | 不代表 |
| --- | --- | --- |
| G0 頁面與兩個獨立瀏覽器會話 | client-only 掛載、同步、離線重連、個人 undo、隔離預覽及待同步內容 | 完整 S1–S5 產品或正式 OAuth |
| Worker 公開 WebSocket／HTTP 介面 | 簽名身分、限文件／世代授權、viewer 拒寫、保存確認、權威快照 | Supabase RLS 或正式分享／撤權整合 |
| 相同 SQLite 儲存的 workerd runtime 重啟 | 已確認內容及有效世代跨程序生命週期保留 | Cloudflare 遠端區域／負載／網路驗收 |

## 執行原則

- 每次一個失敗測試，再加入足以通過的最小實作，保留 red／green 紀錄。
- 使用本機 Miniflare／workerd 的真實 Durable Object SQLite 儲存與 tldraw sync，不使用公開 demo 房間。
- 測試身分以每輪隨機私鑰簽名、短效且限文件／角色／世代；金鑰不提供給瀏覽器。這不是 Supabase 登入替代品。
- G0 頁面必須明確啟用且僅供 development；production 預設不可進入，Worker 不提供公開發票證／切換身分入口。
- 對保存成功的驗證須包含權威內容核對及服務重啟，不以連線成功或發送完成判斷保存。
- 完成後記錄 TV-01–TV-05 的實際版本、公開介面、結果、限制及 AC 對照。任何未通過項目保留阻擋，不能僅因原型存在就關閉 #2。

## 目前實作邊界

TV-01～TV-05 的本機 harness 已建立，結果見 [G0 驗證紀錄](g0-results.md)，保存與世代契約見 [G0 最小契約](g0-contract.md)。同步測試使用 SDK 內建 `geo` 物件與標記；尚未驗證自訂架構節點、連線及筆畫的 client／server schema 整合。

測試 runner 在 Node 端產生預設每輪隨機的 HMAC 金鑰，票證限定文件、角色、世代，五分鐘到期。瀏覽器只取得簽名票證，不取得金鑰；Worker 沒有發票證入口。有效世代由 DO SQLite 持有，還原時與畫布原子切換，舊連線停止且舊票證不可重連。

Worker 只由本機 runner 啟動於 `127.0.0.1:8787`，接受 G0 Next.js 來源；SQLite 每輪獨立暫存，於該輪 runtime 重啟之間保留，結束才清理。Node 控制器位於 port 8788 且須獨立驗證未下發瀏覽器的測試金鑰。TV-02 是瀏覽器重載；TV-04／TV-05 另執行真正 workerd 重啟。Supabase Auth／分享撤銷／RLS 均未整合。

## 官方參考

- [tldraw sync](https://tldraw.dev/docs/sync)：自管房間、SQLite、client／server schema 與 SDK 版本相容性。
- [TLSocketRoom](https://tldraw.dev/reference/sync-core/TLSocketRoom)：唯讀連線、快照及房間生命週期介面。
- [Cloudflare Durable Object WebSockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)：runtime 的 WebSocket 行為。
