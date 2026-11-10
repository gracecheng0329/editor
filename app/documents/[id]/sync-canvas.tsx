'use client'
import { useSync } from '@tldraw/sync'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
   atom,
   createUserId,
   defaultShapeUtils,
   isEqual,
   type SerializedStore,
   type TLRecord,
   Tldraw,
   useEditor,
   useValue,
} from 'tldraw'
import {
   type ArchitectureNode,
   architectureShapeUtils,
} from '@/app/web/whiteboard/architecture-shape'
import 'tldraw/tldraw.css'
import { SyncedWorkspaceUi, WorkspaceUnavailable } from '@/app/web/whiteboard/workspace-ui'
import { syncedBindingUtils } from './arrow-binding'
import { ObjectTools } from './object-tools'

export type DocumentWorkspace = {
   heading: ReactNode
   onShare: () => void
   userName: string
   isSharing: boolean
}

const assets = {
   upload: async (): Promise<never> => {
      throw new Error('目前不支援上傳資產。')
   },
}
const shapeUtils = [...defaultShapeUtils, ...architectureShapeUtils]
type Checkpoint = {
   generation: number
   revision: number
   snapshot: { store: SerializedStore<TLRecord> }
}

function CanvasControls({
   connectionStatus,
   confirm,
   workspace,
}: {
   workspace: DocumentWorkspace
   connectionStatus: string
   confirm: (signal: AbortSignal) => Promise<Checkpoint>
}) {
   const editor = useEditor()
   const canvasRecords = useValue('canvas document', () => editor.store.serialize('document'), [
      editor,
   ])
   const nodes = useValue(
      'canvas nodes',
      () =>
         editor
            .getCurrentPageShapes()
            .filter((shape): shape is ArchitectureNode => shape.type === 'architecture-node'),
      [editor],
   )
   const selected = useValue(
      'selected node',
      () =>
         editor
            .getSelectedShapes()
            .find((shape): shape is ArchitectureNode => shape.type === 'architecture-node'),
      [editor],
   )
   const collaborators = useValue(
      'collaborators',
      () => editor.getVisibleCollaboratorsOnCurrentPage(),
      [editor],
   )
   const [name, setName] = useState('應用服務')
   const [checkpoint, setCheckpoint] = useState<Checkpoint | null>(null)
   const [error, setError] = useState(false)
   const [retry, setRetry] = useState(0)
   const confirmed = checkpoint !== null && isEqual(canvasRecords, checkpoint.snapshot.store)
   // biome-ignore lint/correctness/useExhaustiveDependencies: Each document edit or retry must cancel stale checkpoint requests and restart confirmation.
   useEffect(() => {
      if (connectionStatus !== 'online' || confirmed) return
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout>
      async function check() {
         try {
            const value = await confirm(controller.signal)
            if (controller.signal.aborted) return
            setCheckpoint(value)
            setError(false)
         } catch {
            if (controller.signal.aborted) return
            setError(true)
         }
         if (!controller.signal.aborted) timer = setTimeout(check, 1000)
      }
      timer = setTimeout(check, 350)
      return () => {
         controller.abort()
         clearTimeout(timer)
      }
   }, [connectionStatus, confirmed, canvasRecords, confirm, retry])
   return (
      <SyncedWorkspaceUi
         isSharing={workspace.isSharing}
         userName={workspace.userName}
         heading={workspace.heading}
         onShare={workspace.onShare}
         collaborators={collaborators.map((peer) => ({
            id: peer.id,
            name: peer.userName,
            color: peer.color,
         }))}
         status={
            <>
               <output aria-label='同步狀態'>
                  {connectionStatus === 'online' ? '已連線' : '離線'}
               </output>
               <output aria-label='保存狀態'>
                  {connectionStatus !== 'online'
                     ? '離線／待同步'
                     : error
                       ? '保存失敗／待同步'
                       : confirmed
                         ? '已確認持久化'
                         : '尚未確認保存'}
               </output>
               {error && (
                  <button type='button' onClick={() => setRetry((value) => value + 1)}>
                     重試保存
                  </button>
               )}
            </>
         }
         tools={
            <section className='canvas-controls' aria-label='節點工具'>
               <label>
                  新增節點名稱
                  <input
                     aria-label='新增節點名稱'
                     value={name}
                     onChange={(event) => setName(event.target.value)}
                  />
               </label>
               <button
                  type='button'
                  onClick={() =>
                     editor.createShape<ArchitectureNode>({
                        type: 'architecture-node',
                        x: 100 + (nodes.length % 3) * 280,
                        y: 180 + Math.floor(nodes.length / 3) * 160,
                        props: { title: name },
                     })
                  }
               >
                  新增節點
               </button>
               {selected && (
                  <>
                     <label>
                        選取節點名稱
                        <input
                           aria-label='選取節點名稱'
                           value={selected.props.title}
                           onChange={(event) =>
                              editor.updateShape<ArchitectureNode>({
                                 id: selected.id,
                                 type: selected.type,
                                 props: { title: event.target.value },
                              })
                           }
                        />
                     </label>
                     <button
                        type='button'
                        onClick={() =>
                           editor.updateShape({
                              id: selected.id,
                              type: selected.type,
                              x: selected.x + 40,
                           })
                        }
                     >
                        向右移動節點
                     </button>
                     <button type='button' onClick={() => editor.deleteShapes([selected.id])}>
                        刪除選取節點
                     </button>
                  </>
               )}
               <ObjectTools />
               <ul aria-label='畫布節點'>
                  {nodes.map((node) => (
                     <li key={node.id}>
                        <button
                           type='button'
                           aria-label={`選取 ${node.props.title}`}
                           onClick={() => editor.select(node.id)}
                        >
                           {node.props.title} (x:{Math.round(node.x)}, y:{Math.round(node.y)}){' '}
                           {Math.round(node.props.w)} × {Math.round(node.props.h)}
                        </button>
                     </li>
                  ))}
               </ul>
            </section>
         }
      />
   )
}

type Identity = { id: string; name: string }
function ConnectedCanvas({
   documentId,
   identity,
   onRetry,
   workspace,
}: {
   workspace: DocumentWorkspace
   documentId: string
   identity: Identity
   onRetry: () => void
}) {
   const users = useMemo(() => {
      const colors = ['#4f46e5', '#be185d', '#047857', '#b45309', '#0369a1', '#7e22ce']
      const color =
         colors[
            Array.from(identity.id).reduce(
               (hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0,
               0,
            ) % colors.length
         ]
      return {
         currentUser: atom('authenticated user', {
            id: createUserId(identity.id),
            name: identity.name,
            color,
            imageUrl: '',
            typeName: 'user' as const,
            meta: {},
         }),
      }
   }, [identity])
   const token = useRef('')
   const base = process.env.NEXT_PUBLIC_SYNC_URL
   const roomURL = `${base}/documents/${encodeURIComponent(documentId)}`
   const uri = useCallback(async () => {
      const response = await fetch(
         `/api/documents/${encodeURIComponent(documentId)}/sync-session`,
         { cache: 'no-store' },
      )
      if (!response.ok) throw new Error('無法取得文件存取資格')
      const session = await response.json()
      token.current = session.accessToken
      const issued = await fetch(`${roomURL}/session`, {
         method: 'POST',
         headers: { Authorization: `Bearer ${token.current}` },
         cache: 'no-store',
      })
      if (!issued.ok) throw new Error('無法取得畫布連線資格')
      const { ticket } = await issued.json()
      const url = new URL(roomURL)
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
      url.searchParams.set('ticket', ticket)
      return url.toString()
   }, [documentId, roomURL])
   const confirm = useCallback(
      async (signal: AbortSignal): Promise<Checkpoint> => {
         const response = await fetch(`${roomURL}/checkpoint`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token.current}` },
            cache: 'no-store',
            signal,
         })
         if (!response.ok) throw new Error('保存確認失敗')
         return response.json()
      },
      [roomURL],
   )
   const store = useSync({ uri, assets, shapeUtils, bindingUtils: syncedBindingUtils, users })
   if (store.status !== 'synced-remote')
      return (
         <WorkspaceUnavailable {...workspace}>
            <p role='status'>
               {store.status === 'error' ? '同步連線失敗，請重試。' : '正在連接同步服務…'}
            </p>
            {store.status === 'error' && (
               <button type='button' onClick={onRetry}>
                  重新連線
               </button>
            )}
         </WorkspaceUnavailable>
      )
   return (
      <section className='whiteboard-app document-workspace' aria-label='文件畫布'>
         <Tldraw
            store={store}
            shapeUtils={shapeUtils}
            bindingUtils={syncedBindingUtils}
            hideUi
            onMount={(editor) => {
               editor.updateInstanceState({ isGridMode: true })
            }}
         >
            <CanvasControls
               workspace={workspace}
               connectionStatus={store.connectionStatus}
               confirm={confirm}
            />
         </Tldraw>
      </section>
   )
}

export default function SyncCanvas({
   documentId,
   workspace,
}: {
   documentId: string
   workspace: DocumentWorkspace
}) {
   const [attempt, setAttempt] = useState(0)
   const [identity, setIdentity] = useState<Identity | null>(null)
   const [failed, setFailed] = useState(false)
   // biome-ignore lint/correctness/useExhaustiveDependencies: Changing attempt explicitly retries session acquisition after a failure.
   useEffect(() => {
      const controller = new AbortController()
      fetch(`/api/documents/${encodeURIComponent(documentId)}/sync-session`, {
         cache: 'no-store',
         signal: controller.signal,
      })
         .then((response) => {
            if (!response.ok) throw new Error()
            return response.json()
         })
         .then((session) => setIdentity(session.user))
         .catch(() => {
            if (!controller.signal.aborted) setFailed(true)
         })
      return () => controller.abort()
   }, [documentId, attempt])
   if (!process.env.NEXT_PUBLIC_SYNC_URL)
      return (
         <WorkspaceUnavailable {...workspace}>
            <p role='alert'>畫布同步服務尚未設定。</p>
         </WorkspaceUnavailable>
      )
   if (failed)
      return (
         <WorkspaceUnavailable {...workspace}>
            <p role='status'>同步連線失敗，請重試。</p>
            <button
               type='button'
               onClick={() => {
                  setFailed(false)
                  setAttempt((value) => value + 1)
               }}
            >
               重新連線
            </button>
         </WorkspaceUnavailable>
      )
   if (!identity)
      return (
         <WorkspaceUnavailable {...workspace}>
            <p role='status'>正在連接同步服務…</p>
         </WorkspaceUnavailable>
      )
   return (
      <ConnectedCanvas
         key={attempt}
         workspace={workspace}
         identity={identity}
         documentId={documentId}
         onRetry={() => setAttempt((value) => value + 1)}
      />
   )
}
