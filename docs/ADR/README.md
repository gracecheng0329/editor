# 架構決策索引

更新日期：2026-11-17。以下決策來自已確認的產品討論與 [總規格 v2](../specs/001-collaborative-architecture-whiteboard.md)。`accepted` 表示選擇已確認，不代表程式已實作或技術驗證已通過。

| ADR | 決策 | 狀態 |
| --- | --- | --- |
| [0001](0001-react-and-single-canvas-sync.md) | React 畫布與單一同步引擎 | accepted |
| [0002](0002-split-canvas-and-product-data-authority.md) | 分開畫布與產品資料權威 | accepted |
| [0003](0003-share-capability-and-server-enforced-access.md) | 分享閱讀能力與服務端權限 | accepted |
| [0004](0004-generation-based-version-restore.md) | 以世代切換處理版本還原 | accepted |

G0 已有最小本機驗證，S4 有本機服務驗證；這些不代表完整產品／部署驗收或 S5 故障恢復已完成。測試結果與進場門檻見總規格的 G0、S4 與 S5。可直接調整的數值預設、樣式及交付順序不另建立 ADR。

2026-11-17：#15 的重試／保留與相容政策已由使用者明確確認，補充 ADR-0002／0004；見 [決策及確認紀錄](../decisions/s5-version-policy-proposal.md)。
