'use client';
import dynamic from 'next/dynamic';
const SyncCanvas = dynamic(() => import('./sync-canvas'), { ssr: false, loading: () => <p>正在連接同步服務…</p> });
export function DocumentCanvas({ id }: { id: string }) {
  return <SyncCanvas documentId={id} />;
}
