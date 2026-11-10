'use client'
import dynamic from 'next/dynamic'
import type { DocumentWorkspace } from './sync-canvas'

const SyncCanvas = dynamic(() => import('./sync-canvas'), {
   ssr: false,
   loading: () => <p>正在連接同步服務…</p>,
})
export function DocumentCanvas({ id, workspace }: { id: string; workspace: DocumentWorkspace }) {
   return <SyncCanvas documentId={id} workspace={workspace} />
}
