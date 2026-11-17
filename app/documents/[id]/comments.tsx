'use client'

import { createClient } from '@supabase/supabase-js'
import { ArrowUpRight, Link2, MessageCircle, Send, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { type TLShape, type TLShapeId, useEditor, useValue } from 'tldraw'

type Point = { x: number; y: number }
type CommentMessage = {
   id: string
   authorId: string | null
   author: string
   body: string
   createdAt: string
}
type CommentAnchor =
   | { type: 'world'; x: number; y: number }
   | {
        type: 'object'
        objectId: string
        offset: Point
        world: Point
        exists: boolean
     }
type CommentThread = {
   id: string
   revision: number
   createdAt: string
   anchor: CommentAnchor
   messages: CommentMessage[]
}
type CommentList = {
   role: 'owner' | 'editor' | 'viewer'
   canWrite: boolean
   threads: CommentThread[]
}

function anchorWorldPoint(
   anchor: CommentAnchor,
   editor: ReturnType<typeof useEditor>,
   shape: TLShape | undefined,
   lastKnown?: Point,
) {
   if (anchor.type === 'world') return { x: anchor.x, y: anchor.y }
   return shape
      ? editor.getShapePageTransform(shape).applyToPoint(anchor.offset)
      : lastKnown ?? anchor.world
}

function pageOffset(editor: ReturnType<typeof useEditor>, shape: TLShape, point: Point) {
   return editor.getShapePageTransform(shape).clone().invert().applyToPoint(point)
}

export function DocumentComments({
   documentId,
   shareToken,
}: {
   documentId: string
   shareToken: string
}) {
   const editor = useEditor()
   const shapes = useValue('comment anchor objects', () => editor.getCurrentPageShapes(), [editor])
   const shapesById = useMemo(() => new Map(shapes.map((shape) => [shape.id, shape])), [shapes])
   const camera = useValue('comment anchor camera', () => editor.getCamera(), [editor])
   const selection = useValue('comment anchor selection', () => editor.getSelectedShapes(), [editor])
   const [open, setOpen] = useState(false)
   const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null)
   const [data, setData] = useState<CommentList | null>(null)
   const [error, setError] = useState('')
   const [realtime, setRealtime] = useState('連線中')
   const [draft, setDraft] = useState('')
   const [activeThread, setActiveThread] = useState<string | null>(null)
   const [anchorMode, setAnchorMode] = useState<'world' | 'object'>('world')
   const [busy, setBusy] = useState(false)
   const latestWorldPoints = useRef(new Map<string, Point>())
   const sentAnchorPoints = useRef(new Map<string, string>())
   const selectedShape = selection.length === 1 ? selection[0] : null
   const threads = data?.threads ?? []

   useEffect(() => {
      setOverlayRoot(document.querySelector<HTMLElement>('.workspace-ui'))
   }, [])

   const reload = useCallback(async () => {
      const headers = shareToken ? { 'X-Document-Share-Token': shareToken } : undefined
      const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/comments`, {
         headers,
         cache: 'no-store',
      })
      if (!response.ok) {
         if ([401, 403, 404].includes(response.status)) setData(null)
         setError(
            response.status === 401 || response.status === 403 || response.status === 404
               ? '目前沒有讀取此文件討論的資格。'
               : '無法載入討論，請稍後重試。',
         )
         return
      }
      setData((await response.json()) as CommentList)
      setError('')
   }, [documentId, shareToken])

   useEffect(() => {
      let disposed = false
      let client: ReturnType<typeof createClient> | null = null
      let channel: ReturnType<ReturnType<typeof createClient>['channel']> | null = null
      let renewal: ReturnType<typeof setInterval> | undefined

      async function issueTicket() {
         const response = await fetch(
            `/api/documents/${encodeURIComponent(documentId)}/comments/ticket`,
            {
               method: 'POST',
               headers: { 'Content-Type': 'application/json' },
               body: JSON.stringify({ shareToken: shareToken || null }),
               cache: 'no-store',
            },
         )
         if (!response.ok) throw new Error('留言訂閱資格已失效')
         return (await response.json()) as { accessToken: string }
      }

      async function connect() {
         try {
            await reload()
            const url = process.env.NEXT_PUBLIC_SUPABASE_URL
            const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
            if (!url || !anonKey || disposed) return

            const ticket = await issueTicket()
            if (disposed) return
            client = createClient(url, anonKey, {
               auth: {
                  autoRefreshToken: false,
                  detectSessionInUrl: false,
                  persistSession: false,
               },
            })
            await client.realtime.setAuth(ticket.accessToken)
            channel = client
               .channel(`document-comments:${documentId}`, { config: { private: true } })
               .on('broadcast', { event: 'comment_changed' }, () => void reload())
               .subscribe((status) => {
                  if (disposed) return
                  setRealtime(
                     status === 'SUBSCRIBED'
                        ? '即時更新已連線'
                        : status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT'
                          ? '即時更新中斷'
                          : '正在連接即時更新',
                  )
                  if (status === 'SUBSCRIBED') void reload()
               })

            renewal = setInterval(() => {
               void issueTicket()
                  .then((next) => client?.realtime.setAuth(next.accessToken))
                  .catch(async () => {
                     if (disposed) return
                     setRealtime('分享資格已撤銷或已失效')
                     if (client && channel) await client.removeChannel(channel)
                     channel = null
                     if (renewal) clearInterval(renewal)
                  })
            }, 20_000)
         } catch {
            if (!disposed) setRealtime('即時更新目前無法連線')
         }
      }

      void connect()
      return () => {
         disposed = true
         if (renewal) clearInterval(renewal)
         if (client && channel) void client.removeChannel(channel)
      }
   }, [documentId, reload, shareToken])

   const anchorPositions = useMemo(() => {
      // Camera changes move only the screen marker. Saved world coordinates stay fixed.
      void camera // Invalidate this memo when tldraw's mutable camera changes.
      return threads.map((thread, index) => {
         const world = anchorWorldPoint(
            thread.anchor,
            editor,
            thread.anchor.type === 'object'
               ? shapesById.get(thread.anchor.objectId as TLShapeId)
               : undefined,
            latestWorldPoints.current.get(thread.id),
         )
         const screen = editor.pageToScreen(world)
         const viewport = editor.getViewportScreenBounds()
         const visible =
            screen.x >= viewport.x - 10 &&
            screen.y >= viewport.y - 10 &&
            screen.x <= viewport.maxX + 10 &&
            screen.y <= viewport.maxY + 10
         return {
            thread,
            index,
            left: screen.x - viewport.x,
            top: screen.y - viewport.y,
            visible,
         }
      })
   }, [camera, editor, threads, shapesById])

   useEffect(() => {
      if (!data?.canWrite) return
      const updates: { threadId: string; exists: boolean; worldX: number; worldY: number }[] = []
      for (const thread of threads) {
         if (thread.anchor.type !== 'object') continue
         const shape = shapesById.get(thread.anchor.objectId as TLShapeId)
         if (shape) {
            const point = editor
               .getShapePageTransform(shape)
               .applyToPoint(thread.anchor.offset)
            latestWorldPoints.current.set(thread.id, point)
            const fingerprint = `1:${point.x.toFixed(2)}:${point.y.toFixed(2)}`
            if (sentAnchorPoints.current.get(thread.id) !== fingerprint)
               updates.push({ threadId: thread.id, exists: true, worldX: point.x, worldY: point.y })
         } else {
            const point = latestWorldPoints.current.get(thread.id) ?? thread.anchor.world
            const fingerprint = `0:${point.x.toFixed(2)}:${point.y.toFixed(2)}`
            if (sentAnchorPoints.current.get(thread.id) !== fingerprint)
               updates.push({ threadId: thread.id, exists: false, worldX: point.x, worldY: point.y })
         }
      }
      if (!updates.length) return

      const timer = window.setTimeout(() => {
         void fetch(`/api/documents/${encodeURIComponent(documentId)}/comments`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ updates, shareToken: shareToken || null }),
         }).then((response) => {
            if (!response.ok) return
            for (const update of updates)
               sentAnchorPoints.current.set(
                  update.threadId,
                  `${update.exists ? 1 : 0}:${update.worldX.toFixed(2)}:${update.worldY.toFixed(2)}`,
               )
         }).catch(() => undefined)
      }, 180)
      return () => window.clearTimeout(timer)
   }, [data?.canWrite, documentId, editor, shapesById, shareToken, threads])

   function newAnchor() {
      if (anchorMode === 'object') {
         if (!selectedShape) return null
         const bounds = editor.getShapePageBounds(selectedShape)
         const world = bounds?.center ?? editor.getShapePageTransform(selectedShape).applyToPoint({ x: 0, y: 0 })
         return {
            type: 'object',
            objectId: selectedShape.id,
            offset: pageOffset(editor, selectedShape, world),
            world,
         }
      }
      const point = editor.getViewportPageBounds().center
      return { type: 'world', x: point.x, y: point.y }
   }

   async function submit(event: React.FormEvent) {
      event.preventDefault()
      const body = draft.trim()
      if (!body || busy || !data?.canWrite) return
      setBusy(true)
      setError('')
      try {
         const isReply = activeThread !== null && threads.some((thread) => thread.id === activeThread)
         const anchor = isReply ? null : newAnchor()
         if (!isReply && !anchor) {
            setError('請先選取要錨定的物件，或改用畫布世界座標。')
            return
         }
         const endpoint = isReply
            ? `/api/documents/${encodeURIComponent(documentId)}/comments/threads/${encodeURIComponent(activeThread)}/replies`
            : `/api/documents/${encodeURIComponent(documentId)}/comments`
         const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
               body,
               ...(!isReply ? { anchor } : {}),
               shareToken: shareToken || null,
            }),
         })
         if (!response.ok) {
            setError(
               response.status === 401 || response.status === 403
                  ? '登入狀態或分享資格已失效，留言沒有送出。'
                  : '留言沒有送出，請重試。',
            )
            return
         }
         const result = (await response.json()) as { id: string }
         setDraft('')
         setActiveThread(result.id)
         await reload()
      } catch {
         setError('留言沒有送出，請確認連線後重試。')
      } finally {
         setBusy(false)
      }
   }

   function openThread(thread: CommentThread) {
      setOpen(true)
      setActiveThread(thread.id)
      if (thread.anchor.type === 'object') {
         const shape = shapesById.get(thread.anchor.objectId as TLShapeId)
         if (shape) {
            editor.select(shape.id)
            editor.zoomToSelection({ animation: { duration: 200 } })
         }
      }
   }

   return (
      <>
         <button
            type='button'
            className={`icon-button ${open ? 'is-active' : ''}`}
            aria-label='留言討論'
            aria-pressed={open}
            onClick={() => setOpen((value) => !value)}
         >
            <MessageCircle size={19} strokeWidth={1.75} />
         </button>
         {overlayRoot &&
            createPortal(
               <>
                  {anchorPositions.some((item) => item.visible) && (
                     <section className='canvas-comment-pins' aria-label='畫布留言錨點'>
                        {anchorPositions.filter((item) => item.visible).map(({ thread, index, left, top }) => (
                           <button
                              type='button'
                              key={thread.id}
                              className={`comment-pin ${activeThread === thread.id ? 'selected' : ''}`}
                              style={{ left, top }}
                              aria-label={`開啟討論串 ${index + 1}`}
                              onClick={() => openThread(thread)}
                           >
                              {index + 1}
                           </button>
                        ))}
                     </section>
                  )}
                  {open && (
                     <aside className='side-panel floating-surface' aria-label='留言面板'>
                        <header className='panel-header'>
                           <h2>
                              <MessageCircle size={18} />
                              留言討論 <span className='count-badge'>{threads.length}</span>
                           </h2>
                           <button type='button' className='icon-button' aria-label='關閉留言面板' onClick={() => setOpen(false)}>
                              <X size={18} />
                           </button>
                        </header>
                        <div className='comment-realtime-status' role='status'>
                           <span>{realtime}</span>
                           {error && <span role='alert'>{error}</span>}
                        </div>
                        <div className='thread-list'>
                           {threads.map((thread) => {
                              const missing = thread.anchor.type === 'object' && !shapesById.has(thread.anchor.objectId as TLShapeId)
                              return (
                                 <article
                                    key={thread.id}
                                    className={`thread-card ${activeThread === thread.id ? 'selected' : ''}`}
                                 >
                                    <button type='button' className='thread-anchor' onClick={() => openThread(thread)}>
                                       <Link2 size={12} />
                                       {thread.anchor.type === 'object'
                                          ? missing
                                             ? '錨點物件已不存在'
                                             : '物件留言'
                                          : '畫布世界座標留言'}
                                       <ArrowUpRight size={12} />
                                    </button>
                                    {thread.messages.map((message) => (
                                       <div className='comment-message' key={message.id}>
                                          <span className='message-avatar'>{message.author.slice(0, 1)}</span>
                                          <div>
                                             <div className='message-meta'>
                                                <strong>{message.author}</strong>
                                                <time dateTime={message.createdAt}>
                                                   {new Date(message.createdAt).toLocaleTimeString('zh-TW', {
                                                      hour: '2-digit',
                                                      minute: '2-digit',
                                                   })}
                                                </time>
                                             </div>
                                             <p>{message.body}</p>
                                          </div>
                                       </div>
                                    ))}
                                    {data?.canWrite && (
                                       <button
                                          type='button'
                                          className='remote-thread-reply'
                                          onClick={() => setActiveThread(thread.id)}
                                       >
                                          <MessageCircle size={13} /> 回覆
                                       </button>
                                    )}
                                 </article>
                              )
                           })}
                           {threads.length === 0 && (
                              <div className='panel-empty'>
                                 <MessageCircle size={28} />
                                 <h3>讓討論從這裡開始</h3>
                                 <p>留言獨立保存；錨點會跟著物件或世界座標移動。</p>
                              </div>
                           )}
                        </div>
                        {data?.canWrite ? (
                           <form className='comment-composer' onSubmit={(event) => void submit(event)}>
                              <div className='composer-heading'>
                                 <span>
                                    {activeThread
                                       ? '回覆討論串'
                                       : anchorMode === 'object' && selectedShape
                                         ? '在選取物件上新增討論'
                                         : '在目前畫面中心新增討論'}
                                 </span>
                                 {activeThread && (
                                    <button type='button' onClick={() => setActiveThread(null)}>
                                       新增討論
                                    </button>
                                 )}
                              </div>
                              {!activeThread && (
                                 <label className='comment-anchor-mode'>
                                    討論位置
                                    <select
                                       aria-label='討論位置'
                                       value={anchorMode}
                                       onChange={(event) => setAnchorMode(event.target.value as 'world' | 'object')}
                                    >
                                       <option value='world'>目前畫面中心（世界座標）</option>
                                       <option value='object' disabled={!selectedShape}>目前選取物件</option>
                                    </select>
                                 </label>
                              )}
                              <textarea
                                 aria-label='留言內容'
                                 placeholder='分享你的想法…'
                                 maxLength={5000}
                                 value={draft}
                                 onChange={(event) => setDraft(event.target.value)}
                              />
                              <div className='composer-footer'>
                                 <span>送出後會保存至文件討論</span>
                                 <button className='primary-button' type='submit' disabled={!draft.trim() || busy} aria-label='送出留言'>
                                    <Send size={14} />
                                    {busy ? '送出中' : '送出'}
                                 </button>
                              </div>
                           </form>
                        ) : (
                           <div className='comment-readonly-note'>
                              匿名觀看者可閱讀討論；登入並持有效分享連結後可留言或回覆。
                           </div>
                        )}
                     </aside>
                  )}
               </>,
               overlayRoot,
            )}
      </>
   )
}
