"use client";

import { Tldraw, useEditor, useValue } from "tldraw";
import "tldraw/tldraw.css";
import { architectureShapeUtils } from "../web/whiteboard/architecture-shape";
import G0SyncCanvas from "./g0-sync-canvas";

function Controls() {
  const editor = useEditor();
  const count = useValue("G0 object count", () => editor.getCurrentPageShapes().length, [editor]);
  return (
    <section style={{ position: "absolute", inset: "16px auto auto 16px", zIndex: 500, background: "white", padding: 16, borderRadius: 12 }}>
      <h1>G0 同步驗證</h1>
      <p>目前僅驗證 client-only 掛載；尚未連接同步服務。</p>
      <button onClick={() => editor.createShape({ type: "architecture-node", x: 100 + count * 30, y: 180 + count * 30 })}>
        新增節點
      </button>
      <output aria-label="物件數">{count}</output>
    </section>
  );
}

export default function G0Canvas() {
  const room = new URLSearchParams(window.location.search).get("room");
  if (room) return <G0SyncCanvas room={room} token={window.location.hash.slice(1)} />;
  return (
    <main className="whiteboard-app" aria-label="G0 技術驗證畫布">
      <Tldraw hideUi shapeUtils={architectureShapeUtils}>
        <Controls />
      </Tldraw>
    </main>
  );
}
