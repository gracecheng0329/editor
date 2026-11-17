# Supabase Realtime 授權與撤權研究

查核日期：2026-11-15。範圍是已加入頻道的客戶端：分享資格撤銷、JWT 更新／到期，以及 Broadcast 與 Postgres Changes 的差異。

## 版本與環境

本 repo 鎖定 `@supabase/supabase-js` 與 `@supabase/realtime-js` 2.118.0；本機 Realtime JS 原始碼與上游 [v2.118.0 原始碼](https://github.com/supabase/supabase-js/blob/v2.118.0/packages/core/realtime-js/src/RealtimeClient.ts)一致。本 repo 的 [local Supabase 環境](local-supabase.md)沒有啟動 Realtime 服務，因此無法從本機確認服務端版本。以下服務端實作細節引用查核當日上游 `supabase/realtime` `main`；不能據此宣稱 Hosted 專案正運行相同版本或環境設定。

## 官方文件明確承諾

- **私有 Broadcast／Presence 頻道：加入時授權並快取。** Realtime 依 `realtime.messages` RLS 產生頻道存取政策；不會逐則訊息查資料庫。政策在加入頻道，或客戶端傳入新 JWT 時更新。撤掉授權資料列後，仍連線的客戶端會繼續收訊，直到 JWT 到期或客戶端傳入新 JWT；若沒有新 JWT，頻道會在到期時中斷。[Realtime Authorization：Updating RLS policies](https://supabase.com/docs/guides/realtime/authorization#updating-rls-policies)
- **Postgres Changes：逐事件、逐訂閱者做資料表 RLS 授權。** 官方文件明確說，每個資料庫事件會對每個訂閱者做授權檢查；`DELETE` 事件不套用 RLS，因刪除後無法檢查列權限。[Postgres Changes：Scaling](https://supabase.com/docs/guides/realtime/postgres-changes#scaling-postgres-changes) · [Postgres Changes：Receiving old records](https://supabase.com/docs/guides/realtime/postgres-changes#receiving-old-records)
- **JWT 更新介面。** Realtime protocol 的 `access_token` 頻道事件可在不重新加入的情況下更新 token。[Realtime Protocol：Access token refresh](https://supabase.com/docs/guides/realtime/protocol#access-token) SDK 2.118.0 的 `accessToken` callback 在連線和每次 heartbeat 呼叫，預設 heartbeat 為 25 秒；token 有變化時，SDK 對已加入頻道送出 `access_token`。若 token 在 callback 下次執行前過期，服務端會關閉頻道且不自動重新加入。[SDK v2.118.0：callback contract](https://github.com/supabase/supabase-js/blob/v2.118.0/packages/core/realtime-js/src/RealtimeClient.ts#L2085-L2096) · [SDK v2.118.0：token propagation](https://github.com/supabase/supabase-js/blob/v2.118.0/packages/core/realtime-js/src/RealtimeClient.ts#L3100-L3125)
- **登入 JWT 無法被提前撤銷。** Supabase Auth 文件說，access-token JWT 到期前無法撤銷；官方一般建議 1 小時預設，低於 5 分鐘、尤其低於 2 分鐘，不建議一般應用採用，原因包括時鐘偏差及刷新負荷。[Auth sessions：JWT expiration FAQ](https://supabase.com/docs/guides/auth/sessions#frequently-asked-questions) · [JavaScript signOut](https://supabase.com/docs/reference/javascript/auth-signout)

## 60 秒限制與服務端實作

官方文件沒有承諾固定 60 秒的 Realtime ACL 撤權／更新週期。SDK 預設 25 秒 heartbeat 是 callback 呼叫頻率，不是分享撤權延遲 SLA；只有 callback 取得不同 token 時才推送新 token。Supabase Auth 的一般建議到期時間也不是 60 秒。

查核當日上游 Realtime `main` 的頻道程式碼指出，快取政策只在 `access_token` 更新時重新評估，否則 JWT 到期時關閉 socket；同一流程會比較更新前後的讀權限，撤權時關閉頻道。[Realtime channel source](https://github.com/supabase/realtime/blob/main/lib/realtime_web/channels/realtime_channel.ex#L3125-L3187) · [JWT expiry handling](https://github.com/supabase/realtime/blob/main/lib/realtime_web/channels/realtime_channel.ex#L3473-L3497)

該上游版本另有 `ACCESS_TOKEN_THROTTLE_MS`：自架服務預設 10 秒，同一頻道更早到達的 token 更新會合併，等視窗關閉後套用最新 token。這不是 60 秒設定，也不能推論 Hosted 的實際值。[Realtime environment variables](https://github.com/supabase/realtime/blob/main/ENVS.md#L225) · [token update handler](https://github.com/supabase/realtime/blob/main/lib/realtime_web/channels/realtime_channel.ex#L3023-L3069)

## 推論與待整合驗證

- 若 Postgres Changes 的表格 RLS **每次查詢都檢查目前的分享／成員資料列**，刪除該資料列後，後續符合條件的 `INSERT`／`UPDATE` 事件應不再通過授權。這是由逐事件 RLS 契約推得；文件沒有提供撤權傳播時間 SLA。若分享權只存在 JWT claim 而政策不查目前資料列，單純刪資料列不會移除舊 JWT 中的 claim。`DELETE` 事件不受此 RLS 保護。
- 對私有 Broadcast，單靠刪除分享資料列**不能**立即撤銷已加入客戶端。要符合「撤權後停止新事件」的產品要求，必須驗證新 token 送達及政策重算，或驗證 token 到期後的關閉行為；25 秒 callback 和短 TTL 都不是 Hosted 平台對 60 秒內完成的保證。
- 本研究未連接 Hosted 專案，也未做整合測試；事件排程、網路延遲、token callback 失敗及 Hosted 服務版本／設定不在此處驗證範圍。
