'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Document = { id: string; title: string; updated_at: string };
export function DocumentList() {
  const [documents, setDocuments] = useState<Document[] | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function load() {
    try {
      const response = await fetch('/api/documents', { cache: 'no-store' });
      if (!response.ok) throw new Error();
      setDocuments(await response.json());
      setError('');
    } catch { setError('無法載入文件，請再試一次。'); }
  }
  useEffect(() => { void Promise.resolve().then(load); }, []);
  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await fetch('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
      if (!response.ok) { setError(response.status === 422 ? '請輸入文件標題。' : '建立失敗，請再試一次。'); return; }
      setTitle(''); await load();
    } catch { setError('建立失敗，請再試一次。'); } finally { setBusy(false); }
  }
  return <><form onSubmit={create} className="document-form"><label htmlFor="title">新文件標題</label><div><input id="title" value={title} onChange={e => setTitle(e.target.value)} /><button className="primary-button" disabled={busy}>建立文件</button></div></form>
    {error && <p role="alert" className="notice">{error} <button className="plain-button" onClick={() => void load()}>重試</button></p>}
    {documents && (documents.length ? <ul className="document-list">{documents.map(doc => <li key={doc.id}><Link href={`/documents/${doc.id}`}>{doc.title} <span>開啟 →</span></Link></li>)}</ul> : <p>尚無文件，建立第一份文件開始吧。</p>)}
  </>;
}
