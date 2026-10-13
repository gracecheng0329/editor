"use client";

import { useSync } from "@tldraw/sync";
import { useCallback, useRef, useState } from "react";
import { createShapeId, isEqual, Tldraw, useEditor, useValue, type Editor, type TLStoreSnapshot } from "tldraw";
import type { G0Checkpoint } from "./g0-contract";
import "tldraw/tldraw.css";

const assets = { upload: async () => { throw new Error("G0 assets are out of scope"); } };

interface RetainedContent {
  sourceRoom: string;
  generation: number;
  labels: string[];
  document: TLStoreSnapshot;
}

function PreviewContents() {
  const editor = useEditor();
  const labels = useValue("preview labels", () => editor.getCurrentPageShapes().map((shape) => String(shape.meta.label ?? "")).sort().join(","), [editor]);
  return <output aria-label="預覽內容" style={{ position: "absolute", zIndex: 500 }}>{labels}</output>;
}

function Controls({ connectionStatus, room, token, retained }: { connectionStatus: string; room: string; token: string; retained: RetainedContent | null }) {
  const editor = useEditor();
  const shapes = useValue("G0 shapes", () => editor.getCurrentPageShapes(), [editor]);
  const readonly = useValue("G0 readonly", () => editor.getInstanceState().isReadonly, [editor]);
  const [label, setLabel] = useState("OWNER-TV02");
  const [checkpoint, setCheckpoint] = useState<G0Checkpoint | null>(null);
  const [preview, setPreview] = useState<G0Checkpoint | null>(null);
  const [saveError, setSaveError] = useState(false);
  const confirmed = useValue("confirmed document", () => checkpoint !== null && isEqual(editor.store.serialize("document"), checkpoint.snapshot.store), [editor, checkpoint]);
  return (
    <section style={{ position: "absolute", inset: "16px auto auto 16px", zIndex: 500, background: "white", padding: 16, borderRadius: 12 }}>
      <h1>G0 同步驗證</h1>
      <p>本機 workerd／SQLite；測試票證，不代表正式登入或已雲端保存。</p>
      <output aria-label="同步狀態">{connectionStatus}</output>
      <output aria-label="存取模式">{readonly ? "唯讀" : "可編輯"}</output>
      {retained && <div>
        <p role="alert" aria-label="世代衝突">世代已變更，待同步內容已保留</p>
        <button onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify(retained)], { type: "application/json" }));
          const link = document.createElement("a");
          link.href = url;
          link.download = `g0-retained-${room}.json`;
          link.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}>下載保留內容</button>
      </div>}
      <output aria-label="保存狀態">{connectionStatus === "offline" ? "離線／待同步" : saveError ? "保存失敗" : confirmed ? "已確認持久化" : "尚未確認保存"}</output>
      <label>新物件標記<input aria-label="新物件標記" value={label} onChange={(event) => setLabel(event.target.value)} /></label>
      <button disabled={readonly} onClick={() => editor.createShape({ type: "geo", x: 100 + shapes.length * 40, y: 180, meta: { label } })}>新增節點</button>
      <button disabled={readonly} onClick={() => {
        const shape = editor.getCurrentPageShapes().find((item) => item.meta.label === label);
        if (!shape) return;
        editor.markHistoryStoppingPoint("before move");
        editor.updateShape({ id: shape.id, type: shape.type, x: shape.x + 40 });
        editor.markHistoryStoppingPoint("after move");
      }}>移動標記物件</button>
      <button disabled={readonly} onClick={() => editor.undo()}>撤回我的操作</button>
      <button disabled={readonly || connectionStatus !== "online"} onClick={async () => {
        setSaveError(false);
        try {
          const response = await fetch(`http://127.0.0.1:8787/rooms/${room}/snapshots?token=${encodeURIComponent(token)}`, { method: "POST" });
          if (!response.ok) throw new Error("Checkpoint failed");
          setCheckpoint(await response.json());
        } catch { setSaveError(true); }
      }}>建立權威快照</button>
      <output aria-label="版本ID">{checkpoint?.id ?? ""}</output>
      <button disabled={!checkpoint} onClick={() => setPreview(checkpoint)}>預覽快照</button>
      <button disabled={retained !== null} onClick={() => {
        const shape = editor.getCurrentPageShapes()[0];
        if (!shape) return;
        // Deliberately bypass editor UI permissions via the public store API.
        editor.store.put([{ ...shape, id: createShapeId(), x: 400, meta: { label: "FORGED-TV02" } }]);
      }}>嘗試未授權寫入</button>
      <output aria-label="物件數">{shapes.length}</output>
      <output aria-label="節點內容">{shapes.map((shape) => String(shape.meta.label ?? "")).sort().join(",")}</output>
      <output aria-label="物件位置">{shapes.map((shape) => `${shape.meta.label}:${shape.x}`).sort().join(",")}</output>
      {preview && <aside aria-label="隔離版本預覽" style={{ position: "fixed", bottom: 16, right: 16, width: 480, height: 300, background: "white" }}>
        <button onClick={() => setPreview(null)}>關閉預覽</button>
        <div style={{ position: "relative", height: 260 }}>
          <Tldraw key={preview.id} snapshot={preview.snapshot} hideUi onMount={(previewEditor) => { previewEditor.updateInstanceState({ isReadonly: true }); }}>
            <PreviewContents />
          </Tldraw>
        </div>
      </aside>}
    </section>
  );
}

export default function G0SyncCanvas({ room, token }: { room: string; token: string }) {
  const editorRef = useRef<Editor | null>(null);
  const generation = useRef(0);
  const [conflict, setConflict] = useState(false);
  const [retained, setRetained] = useState<RetainedContent | null>(null);
  const uri = useCallback(async () => {
    // Public preflight: stop BEFORE reconnect can rebase or discard the old local document.
    const response = await fetch(`http://127.0.0.1:8787/rooms/${room}/session?token=${encodeURIComponent(token)}`);
    if (response.status === 409) {
      const editor = editorRef.current;
      if (editor) {
        setRetained({
          sourceRoom: room, generation: generation.current,
          labels: editor.getCurrentPageShapes().map((shape) => String(shape.meta.label ?? "")).sort(),
          document: editor.store.getStoreSnapshot("document"),
        });
        editor.updateInstanceState({ isReadonly: true });
      }
      setConflict(true);
      // Pause this connection attempt until the user leaves the retained document.
      // useSync cleanup disposes its adapter; never replay into a new generation.
      return new Promise<string>(() => {});
    }
    if (!response.ok) throw new Error("G0 session unavailable");
    generation.current = (await response.json()).generation;
    return `ws://127.0.0.1:8787/rooms/${encodeURIComponent(room)}?token=${encodeURIComponent(token)}`;
  }, [room, token]);
  const store = useSync({
    uri,
    assets,
  });
  if (conflict && !retained) return <p role="alert">世代已變更，請重新取得存取資格。</p>;
  if (store.status !== "synced-remote") return <p role="status">{store.status === "error" ? "同步連線失敗" : "正在連接同步服務…"}</p>;
  return (
    <main className="whiteboard-app" aria-label="G0 技術驗證畫布">
      <Tldraw store={store} hideUi onMount={(editor) => { editorRef.current = editor; return () => { editorRef.current = null; }; }}>
        <Controls connectionStatus={store.connectionStatus} room={room} token={token} retained={retained} />
      </Tldraw>
    </main>
  );
}
