'use client';
import { useEffect, useState } from 'react';
import { AccessSettings } from './access';
type Document = { title: string; role: 'owner' | 'editor' };
export function DocumentShell({ id }: { id: string }) {
  const [document, setDocument] = useState<Document | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  async function load() {
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!response.ok) { setDocument(null); setError(response.status === 404 ? '找不到文件。' : response.status === 401 ? '請先登入。' : '無法載入文件，請再試一次。'); return; }
      const value: Document = await response.json(); setDocument(value); setTitle(value.title); setError('');
    } catch { setDocument(null); setError('無法載入文件，請再試一次。'); }
  }
  useEffect(() => { void Promise.resolve().then(load); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function rename(event: React.FormEvent) {
    event.preventDefault(); setSaved(false); setError('');
    try {
      const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      if (!response.ok) { setError(response.status === 422 ? '請輸入文件標題。' : '儲存失敗，請再試一次。'); return; }
      const value: Document = await response.json(); setDocument({ ...value, role: 'owner' }); setTitle(value.title); setSaved(true);
    } catch { setError('儲存失敗，請再試一次。'); }
  }
  return <section className="document-content">{error && <p role="alert" className="notice">{error} {!document && <button className="plain-button" onClick={() => void load()}>重試</button>}</p>}{document && <><p className="eyebrow">{document.role === 'owner' ? '擁有者' : '編輯者'}</p><h1>{document.title}</h1>{document.role === 'owner' && <><form onSubmit={rename} className="document-form"><label htmlFor="rename">文件標題</label><div><input id="rename" value={title} onChange={e => { setTitle(e.target.value); setSaved(false); }} /><button className="primary-button">儲存標題</button></div></form>{saved && <p role="status">標題已儲存。</p>}<AccessSettings id={id} /></>}<div className="canvas-placeholder"><strong>畫布</strong><p>畫布功能正在準備中。</p></div></>}</section>;
}
