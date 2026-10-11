---
status: accepted
date: 2026-10-11
---

# 採用 React 畫布與單一同步引擎

本作品集需在 2–4 週預算內展示架構圖、手繪與即時協作，因此選擇 Next.js／React 搭配 tldraw，並由 tldraw sync 與 Cloudflare Durable Objects 管理 WebSocket 房間及畫布同步。相較 Nuxt 的 React 橋接或 React Flow／Vue Flow 加 Yjs 的自建協作路線，此選擇將工作集中在可操作的產品與跨服務整合；同一畫布只保留一個同步權威，不再加入 Yjs。

此決策接受 SDK 與部署環境的整合成本及適用授權要求；本作品不宣稱自行實作 CRDT。SDK 相容性與離線行為仍須依 [G0 技術驗證](../specs/001-collaborative-architecture-whiteboard.md#決策狀態與技術驗證門檻) 取得證據，選擇 accepted 不等同已驗證。
