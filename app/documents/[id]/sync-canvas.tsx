'use client'
import { useSync } from '@tldraw/sync'
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
   atom,
   createUserId,
   defaultShapeUtils,
   type Editor,
   isEqual,
   type SerializedStore,
   type TLRecord,
   type TLDrawShape,
   type TLStoreSnapshot,
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
   title: string
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
type RetainedContent = {
   documentId: string
   reason: 'access' | 'generation'
   generation: number | null
   snapshot: TLStoreSnapshot
}

function CanvasControls({
   connectionStatus,
   confirm,
   onConfirmed,
   workspace,
}: {
   workspace: DocumentWorkspace
   connectionStatus: string
   confirm: (signal: AbortSignal) => Promise<Checkpoint>
   onConfirmed: (store: SerializedStore<TLRecord>) => void
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
   useEffect(() => {
      if (confirmed && checkpoint) onConfirmed(checkpoint.snapshot.store)
   }, [confirmed, checkpoint, onConfirmed])
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

function ReadonlyCanvas({ readOnly }: { readOnly: boolean }) {
   const editor = useEditor()
   useEffect(() => {
      editor.updateInstanceState({ isReadonly: readOnly })
   }, [editor, readOnly])
   return null
}

function AccessDenied({
   title,
   viewer,
}: {
   title: string
   viewer: boolean
}) {
   return (
      <section className='whiteboard-app document-workspace' aria-label='畫布存取已撤銷'>
         <div className='workspace-ui'>
            <header className='document-bar floating-surface'>
               <a className='brand' href={viewer ? '/share' : '/documents'}>
                  <span className='brand-mark'>a</span>
                  <span className='brand-word'>archly<span>✳</span></span>
               </a>
               <span className='divider' />
               <h1>{title}</h1>
            </header>
            <section className='sync-access-status floating-surface'>
               <p role='alert'>
                  {viewer
                     ? '分享連結無效或已撤銷。'
                     : '你已失去此文件的存取資格；撤權後的修改不會保存。'}
               </p>
               <a href={viewer ? '/share' : '/documents'}>
                  {viewer ? '重新開啟分享連結' : '返回我的文件'}
               </a>
            </section>
         </div>
      </section>
   )
}

function SyncUnavailable({
   workspace,
   title,
   viewer,
   onRetry,
}: {
   workspace: DocumentWorkspace | null
   title: string
   viewer: boolean
   onRetry: () => void
}) {
   if (!workspace || viewer)
      return (
         <section className='whiteboard-app document-workspace' aria-label='分享畫布'>
            <div className='workspace-ui'>
               <header className='document-bar floating-surface'>
                  <a className='brand' href='/documents'>
                     <span className='brand-mark'>a</span>
                     <span className='brand-word'>archly<span>✳</span></span>
                  </a>
                  <span className='divider' />
                  <h1>{title}</h1>
               </header>
               <section className='sync-access-status floating-surface'>
                  <p role='status'>同步連線失敗，請再試一次。</p>
                  <button type='button' onClick={onRetry}>重新連線</button>
               </section>
            </div>
         </section>
      )
   return (
      <WorkspaceUnavailable {...workspace}>
         <p role='status'>同步連線失敗，請重試。</p>
         <button type='button' onClick={onRetry}>重新連線</button>
      </WorkspaceUnavailable>
   )
}

type Identity = { id: string; name: string }
function ConnectedCanvas({
   documentId,
   identity,
   onRetry,
   shareToken,
   viewerTitle,
   workspace,
}: {
   workspace: DocumentWorkspace | null
   documentId: string
   identity: Identity
   onRetry: () => void
   shareToken: string
   viewerTitle: string
}) {
   const viewer = workspace === null
   const title = workspace?.title ?? viewerTitle
   const [readOnly, setReadOnly] = useState(viewer)
   const [accessDenied, setAccessDenied] = useState(false)
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
   const editorRef = useRef<Editor | null>(null)
   const generation = useRef<number | null>(null)
   const confirmedRecords = useRef<SerializedStore<TLRecord> | null>(null)
   const reconnectPaused = useRef(false)
   const [retained, setRetained] = useState<RetainedContent | null>(null)
   const rememberConfirmed = useCallback((store: SerializedStore<TLRecord>) => {
      confirmedRecords.current = store
   }, [])
   const pauseForRetainedChanges = useCallback(
      (reason: RetainedContent['reason'], currentGeneration: number | null) => {
         const editor = editorRef.current
         if (!editor) return false
         const records = editor.store.serialize('document')
         const hasPendingChanges =
            reason === 'generation' ||
            confirmedRecords.current === null ||
            !isEqual(records, confirmedRecords.current)
         if (!hasPendingChanges) return false
         setRetained({
            documentId,
            reason,
            generation: currentGeneration,
            snapshot: editor.store.getStoreSnapshot('document'),
         })
         editor.updateInstanceState({ isReadonly: true })
         setReadOnly(true)
         if (reason === 'access') setAccessDenied(true)
         reconnectPaused.current = true
         return true
      },
      [documentId],
   )
   const base = process.env.NEXT_PUBLIC_SYNC_URL
   const roomURL = `${base}/documents/${encodeURIComponent(documentId)}`
   const uri = useCallback(async () => {
      const pause = () => new Promise<string>(() => {})
      if (reconnectPaused.current) return pause()
      const makeUrl = (ticket: string) => {
         const url = new URL(roomURL)
         url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
         url.searchParams.set('ticket', ticket)
         return url.toString()
      }
      const acceptTicket = async (issued: Response, viewerTicket: boolean) => {
         if (!issued.ok) throw new Error('無法取得畫布連線資格')
         const session = (await issued.json()) as { ticket?: string; generation?: unknown }
         if (
            !session.ticket ||
            !Number.isSafeInteger(session.generation) ||
            (session.generation as number) < 0
         )
            throw new Error('無效的畫布連線資格')
         const nextGeneration = session.generation as number
         if (generation.current !== null && generation.current !== nextGeneration) {
            pauseForRetainedChanges('generation', nextGeneration)
            if (reconnectPaused.current) return pause()
            throw new Error('畫布世代已變更')
         }
         generation.current = nextGeneration
         setReadOnly(viewerTicket)
         setAccessDenied(false)
         return makeUrl(session.ticket)
      }
      const issueShareTicket = async () => {
         const issued = await fetch(`${roomURL}/session`, {
            method: 'POST',
            headers: { 'X-Share-Token': shareToken },
            cache: 'no-store',
         })
         if (!issued.ok) {
            if ([401, 403, 404].includes(issued.status)) setAccessDenied(true)
            throw new Error('分享連結無效或已撤銷')
         }
         return acceptTicket(issued, true)
      }
      if (viewer) return issueShareTicket()

      const response = await fetch(
         `/api/documents/${encodeURIComponent(documentId)}/sync-session`,
         { cache: 'no-store' },
      )
      if (!response.ok) {
         if ([401, 403, 404].includes(response.status)) {
            if (pauseForRetainedChanges('access', generation.current)) return pause()
         }
         if (shareToken && [401, 403, 404].includes(response.status))
            return issueShareTicket()
         if ([401, 403, 404].includes(response.status)) setAccessDenied(true)
         throw new Error('無法取得文件存取資格')
      }
      const session = await response.json()
      token.current = session.accessToken
      const issued = await fetch(`${roomURL}/session`, {
         method: 'POST',
         headers: { Authorization: `Bearer ${token.current}` },
         cache: 'no-store',
      })
      if (!issued.ok) {
         if ([401, 403, 404].includes(issued.status)) {
            if (pauseForRetainedChanges('access', generation.current)) return pause()
         }
         if (shareToken && [401, 403, 404].includes(issued.status))
            return issueShareTicket()
         if ([401, 403, 404].includes(issued.status)) setAccessDenied(true)
         throw new Error('無法取得畫布連線資格')
      }
      return acceptTicket(issued, false)
   }, [documentId, pauseForRetainedChanges, roomURL, shareToken, viewer])
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
   if (accessDenied && !retained) return <AccessDenied title={title} viewer={readOnly} />
   if (store.status !== 'synced-remote')
      return store.status === 'error' ? (
         <SyncUnavailable workspace={workspace} title={title} viewer={readOnly} onRetry={onRetry} />
      ) : (
         <section className='whiteboard-app document-workspace' aria-label={viewer ? '分享畫布' : '文件畫布'}>
            <p role='status'>正在連接同步服務…</p>
         </section>
      )
   return (
      <section className='whiteboard-app document-workspace' aria-label={readOnly ? '分享畫布' : '文件畫布'}>
         <Tldraw
            store={store}
            shapeUtils={shapeUtils}
            bindingUtils={syncedBindingUtils}
            hideUi
            onMount={(editor) => {
               editorRef.current = editor
               editor.updateInstanceState({ isGridMode: true, isReadonly: readOnly })
               return () => {
                  if (editorRef.current === editor) editorRef.current = null
               }
            }}
         >
            <ReadonlyCanvas readOnly={readOnly} />
            {readOnly ? (
               <ViewerCanvasControls
                  connectionStatus={store.connectionStatus}
                  title={title}
                  retained={retained}
               />
            ) : (
               workspace && (
                  <CanvasControls
                     workspace={workspace}
                     connectionStatus={store.connectionStatus}
                     confirm={confirm}
                     onConfirmed={rememberConfirmed}
                  />
               )
            )}
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
   const [shareToken, setShareToken] = useState('')
   // biome-ignore lint/correctness/useExhaustiveDependencies: Changing attempt explicitly retries session acquisition after a failure.
   useEffect(() => {
      const controller = new AbortController()
      const fragment = window.location.hash.slice(1)
      setShareToken(/^[A-Za-z0-9_-]{43}$/.test(fragment) ? fragment : '')
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
         shareToken={shareToken}
         viewerTitle={workspace.title}
         onRetry={() => setAttempt((value) => value + 1)}
      />
   )
}

function ViewerCanvasControls({
   connectionStatus,
   retained,
   title,
}: {
   connectionStatus: string
   retained: RetainedContent | null
   title: string
}) {
   const editor = useEditor()
   const nodes = useValue(
      'viewer canvas nodes',
      () =>
         editor
            .getCurrentPageShapes()
            .filter((shape): shape is ArchitectureNode => shape.type === 'architecture-node'),
      [editor],
   )
   const strokes = useValue(
      'viewer canvas strokes',
      () =>
         editor
            .getCurrentPageShapes()
            .filter((shape): shape is TLDrawShape => shape.type === 'draw'),
      [editor],
   )
   return (
      <div className='workspace-ui viewer-workspace'>
         <header className='document-bar floating-surface'>
            <a className='brand' href='/documents' aria-label='回到我的文件'>
               <span className='brand-mark'>a</span>
               <span className='brand-word'>archly<span>✳</span></span>
            </a>
            <span className='divider' />
            <div className='document-heading'>
               <h1>{title}</h1>
               <span>{retained ? '待同步內容已保留' : '觀看者・唯讀'}</span>
            </div>
         </header>
         <div className='collaboration-bar floating-surface'>
            <output aria-label='同步狀態'>
               {retained ? '已暫停同步' : connectionStatus === 'online' ? '已連線' : '離線'}
            </output>
            <span className='divider' />
            <span>{retained ? '本機內容未送出' : '觀看者・唯讀'}</span>
         </div>
         {retained && (
            <section
               className='sync-access-status floating-surface retained-changes'
               aria-label='待同步內容已保留'
            >
               <p role='alert'>
                  {retained.reason === 'generation'
                     ? '畫布世代已變更。此頁的待同步修改尚未送入目前畫布，已保留在本機。'
                     : '寫入資格已失效。此頁的待同步修改尚未送入雲端，已保留在本機。'}
                  {' '}離開頁面前請先下載內容。
               </p>
               <button
                  type='button'
                  onClick={() => {
                     const url = URL.createObjectURL(
                        new Blob([JSON.stringify(retained, null, 2)], {
                           type: 'application/json',
                        }),
                     )
                     const link = document.createElement('a')
                     link.href = url
                     link.download = `canvas-${retained.documentId}-pending.json`
                     link.click()
                     setTimeout(() => URL.revokeObjectURL(url), 1000)
                  }}
               >
                  下載待同步內容
               </button>
            </section>
         )}
         <ul className='viewer-object-list floating-surface' aria-label='畫布節點'>
            {nodes.map((node) => (
               <li key={node.id}>
                  {node.props.title} (x:{Math.round(node.x)}, y:{Math.round(node.y)})
               </li>
            ))}
         </ul>
         {retained && (
            <ul
               className='viewer-object-list viewer-stroke-list floating-surface'
               aria-label='畫布筆畫'
            >
               {strokes.map((stroke) => (
                  <li key={stroke.id}>
                     {stroke.props.color} · {stroke.props.size}
                  </li>
               ))}
            </ul>
         )}
      </div>
   )
}

export function SharedSyncCanvas({
   documentId,
   shareToken,
   title,
}: {
   documentId: string
   shareToken: string
   title: string
}) {
   const [attempt, setAttempt] = useState(0)
   const [identity] = useState<Identity>(() => ({ id: crypto.randomUUID(), name: '分享觀看者' }))
   return (
      <ConnectedCanvas
         key={attempt}
         workspace={null}
         identity={identity}
         documentId={documentId}
         shareToken={shareToken}
         viewerTitle={title}
         onRetry={() => setAttempt((value) => value + 1)}
      />
   )
}
