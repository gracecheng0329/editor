'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSync } from '@tldraw/sync';
import { Tldraw, atom, createUserId, defaultShapeUtils, useEditor, useValue, isEqual, type SerializedStore, type TLRecord } from 'tldraw';
import { architectureShapeUtils, type ArchitectureNode } from '@/app/web/whiteboard/architecture-shape';
import 'tldraw/tldraw.css';

const assets = { upload: async (): Promise<never> => { throw new Error('目前不支援上傳資產。'); } };
const shapeUtils = [...defaultShapeUtils, ...architectureShapeUtils];
type Checkpoint = { generation: number; revision: number; snapshot: { store: SerializedStore<TLRecord> } };

function CanvasControls({ connectionStatus, confirm }: { connectionStatus: string; confirm: (signal: AbortSignal) => Promise<Checkpoint> }) {
  const editor = useEditor();
  const canvasRecords = useValue('canvas document', () => editor.store.serialize('document'), [editor]);
  const nodes = useValue('canvas nodes', () => editor.getCurrentPageShapes().filter((shape): shape is ArchitectureNode => shape.type === 'architecture-node'), [editor]);
  const selected = useValue('selected node', () => editor.getSelectedShapes().find((shape): shape is ArchitectureNode => shape.type === 'architecture-node'), [editor]);
  const collaborators = useValue('collaborators', () => editor.getVisibleCollaboratorsOnCurrentPage(), [editor]);
  const [name, setName] = useState('應用服務');
  const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const confirmed = checkpoint !== null && isEqual(canvasRecords, checkpoint.snapshot.store);
  useEffect(() => {
    if (connectionStatus !== 'online' || confirmed) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function check() {
      try {
        const value = await confirm(controller.signal);
        if (controller.signal.aborted) return;
        setCheckpoint(value);
        setError(false);
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(check, 1000);
    }
    timer = setTimeout(check, 350);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [connectionStatus, confirmed, canvasRecords, confirm, retry]);
  return <section className="canvas-controls" aria-label="節點工具">
    <ul aria-label="協作者">{collaborators.map(peer => <li key={peer.id}>{peer.userName}</li>)}</ul>
    <output aria-label="同步狀態">{connectionStatus === 'online' ? '已連線' : '離線'}</output>
    <output aria-label="保存狀態">{connectionStatus !== 'online' ? '離線／待同步' : error ? '保存失敗／待同步' : confirmed ? '已確認持久化' : '尚未確認保存'}</output>
    {error && <button onClick={() => setRetry(value => value + 1)}>重試保存</button>}
    <label>新增節點名稱<input aria-label="新增節點名稱" value={name} onChange={event => setName(event.target.value)} /></label>
    <button onClick={() => editor.createShape<ArchitectureNode>({ type: 'architecture-node', x: 100, y: 180, props: { title: name } })}>新增節點</button>
    {selected && <>
      <label>選取節點名稱<input aria-label="選取節點名稱" value={selected.props.title} onChange={event => editor.updateShape<ArchitectureNode>({ id: selected.id, type: selected.type, props: { title: event.target.value } })} /></label>
      <button onClick={() => editor.updateShape({ id: selected.id, type: selected.type, x: selected.x + 40 })}>向右移動節點</button>
      <button onClick={() => editor.deleteShapes([selected.id])}>刪除選取節點</button>
    </>}
    <ul aria-label="畫布節點">{nodes.map(node => <li key={node.id}><button aria-label={`選取 ${node.props.title}`} onClick={() => editor.select(node.id)}>{node.props.title} (x:{Math.round(node.x)}, y:{Math.round(node.y)})</button></li>)}</ul>
  </section>;
}

type Identity = { id: string; name: string };
function ConnectedCanvas({ documentId, identity, onRetry }: { documentId: string; identity: Identity; onRetry: () => void }) {
  const users = useMemo(() => {
    const colors = ['#4f46e5', '#be185d', '#047857', '#b45309', '#0369a1', '#7e22ce'];
    const color = colors[Array.from(identity.id).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % colors.length];
    return { currentUser: atom('authenticated user', { id: createUserId(identity.id), name: identity.name, color, imageUrl: '', typeName: 'user' as const, meta: {} }) };
  }, [identity]);
  const token = useRef('');
  const base = process.env.NEXT_PUBLIC_SYNC_URL;
  const roomURL = `${base}/documents/${encodeURIComponent(documentId)}`;
  const uri = useCallback(async () => {
    const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/sync-session`, { cache: 'no-store' });
    if (!response.ok) throw new Error('無法取得文件存取資格');
    const session = await response.json();
    token.current = session.accessToken;
    const issued = await fetch(`${roomURL}/session`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}` }, cache: 'no-store' });
    if (!issued.ok) throw new Error('無法取得畫布連線資格');
    const { ticket } = await issued.json();
    const url = new URL(roomURL);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('ticket', ticket);
    return url.toString();
  }, [documentId, roomURL]);
  const confirm = useCallback(async (signal: AbortSignal): Promise<Checkpoint> => {
    const response = await fetch(`${roomURL}/checkpoint`, { method: 'POST', headers: { Authorization: `Bearer ${token.current}` }, cache: 'no-store', signal });
    if (!response.ok) throw new Error('保存確認失敗');
    return response.json();
  }, [roomURL]);
  const store = useSync({ uri, assets, shapeUtils, users });
  if (store.status !== 'synced-remote') return <div><p role="status">{store.status === 'error' ? '同步連線失敗，請重試。' : '正在連接同步服務…'}</p>{store.status === 'error' && <button onClick={onRetry}>重新連線</button>}</div>;
  return <div className="document-canvas" aria-label="文件畫布"><Tldraw store={store} shapeUtils={shapeUtils} hideUi><CanvasControls connectionStatus={store.connectionStatus} confirm={confirm} /></Tldraw></div>;
}

export default function SyncCanvas({ documentId }: { documentId: string }) {
  const [attempt, setAttempt] = useState(0);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/documents/${encodeURIComponent(documentId)}/sync-session`, { cache: 'no-store', signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error(); return response.json(); })
      .then(session => setIdentity(session.user))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [documentId, attempt]);
  if (!process.env.NEXT_PUBLIC_SYNC_URL) return <p role="alert">畫布同步服務尚未設定。</p>;
  if (failed) return <div><p role="status">同步連線失敗，請重試。</p><button onClick={() => { setFailed(false); setAttempt(value => value + 1); }}>重新連線</button></div>;
  if (!identity) return <p role="status">正在連接同步服務…</p>;
  return <ConnectedCanvas key={attempt} identity={identity} documentId={documentId} onRetry={() => setAttempt(value => value + 1)} />;
}
