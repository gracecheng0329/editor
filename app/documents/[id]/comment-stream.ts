'use client'

import { createClient } from '@supabase/supabase-js'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommentList } from './comment-types'

// Events are hints. Only serialized, authorized Postgres reads update the UI.
export function useCommentStream(documentId: string, shareToken: string) {
   const [data, setData] = useState<CommentList | null>(null)
   const [error, setError] = useState('')
   const [realtime, setRealtime] = useState('連線中')
   const [attempt, setAttempt] = useState(0)
   const read = useRef<() => Promise<void>>(async () => {})
   const reload = useCallback(() => read.current(), [])
   const reconnect = useCallback(() => setAttempt((value) => value + 1), [])

   useEffect(() => {
      void attempt // A manual reconnect starts a fresh, independently cancellable subscription.
      let disposed = false
      let denied = false
      let queued = false
      let pending: Promise<void> | null = null
      let connecting = false
      let retry: ReturnType<typeof setTimeout> | undefined
      const controller = new AbortController()
      let realtimeAccessToken: string | null = null
      const client = createClient(
         process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
         process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
         {
            auth: {
               autoRefreshToken: false,
               detectSessionInUrl: false,
               persistSession: false,
               storageKey: `comment-stream:${documentId}:${attempt}`,
            },
            accessToken: async () => realtimeAccessToken,
         },
      )
      let channel: ReturnType<typeof client.channel> | null = null
      setData(null)
      setError('')
      setRealtime('正在連接即時更新')

      function deny() {
         denied = true
         queued = false
         if (retry) clearTimeout(retry)
         setData(null)
         setError('目前沒有讀取此文件討論的資格。')
         setRealtime('留言存取資格已失效')
         realtimeAccessToken = null
         if (channel) void client.removeChannel(channel)
         channel = null
      }

      async function drain() {
         while (queued && !disposed && !denied) {
            queued = false
            try {
               const response = await fetch(
                  `/api/documents/${encodeURIComponent(documentId)}/comments`,
                  {
                     headers: shareToken ? { 'X-Document-Share-Token': shareToken } : undefined,
                     cache: 'no-store',
                     signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
                  },
               )
               if (disposed || denied) return
               if ([401, 403, 404].includes(response.status)) {
                  deny()
                  return
               }
               if (!response.ok) throw new Error('comment_read_failed')
               const next = (await response.json()) as CommentList
               if (!disposed && !denied) {
                  setData(next)
                  setError('')
               }
            } catch {
               if (!disposed && !denied) setError('無法載入討論，正在重試；也可重新連線留言。')
            }
         }
      }

      function refresh() {
         if (disposed || denied) return Promise.resolve()
         queued = true
         if (!pending)
            pending = drain().finally(() => {
               pending = null
            })
         return pending
      }
      read.current = refresh

      function scheduleRetry() {
         if (disposed || denied || retry) return
         retry = setTimeout(() => {
            retry = undefined
            void connect()
         }, 2000)
      }

      async function connect() {
         if (disposed || denied || connecting) return
         connecting = true
         try {
            const response = await fetch(
               `/api/documents/${encodeURIComponent(documentId)}/comments/ticket`,
               {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ shareToken: shareToken || null }),
                  cache: 'no-store',
                  signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]),
               },
            )
            if (disposed || denied) return
            if ([401, 403, 404].includes(response.status)) {
               deny()
               return
            }
            if (!response.ok) throw new Error('comment_ticket_failed')
            const ticket = (await response.json()) as { accessToken: string }
            if (disposed || denied) return
            const previous = channel
            channel = null
            if (previous) await client.removeChannel(previous)
            if (disposed || denied) return
            realtimeAccessToken = ticket.accessToken
            await client.realtime.setAuth(ticket.accessToken)
            if (disposed || denied) return
            const nextChannel = client
               .channel(`document-comments:${documentId}`, { config: { private: true } })
               .on('broadcast', { event: 'comment_changed' }, () => {
                  void refresh()
               })
            channel = nextChannel
            nextChannel.subscribe((status) => {
               if (disposed || denied || channel !== nextChannel) return
               if (status === 'SUBSCRIBED') {
                  setRealtime('即時更新已連線')
                  void refresh()
               } else if (['CHANNEL_ERROR', 'CLOSED', 'TIMED_OUT'].includes(status)) {
                  setRealtime('即時更新中斷，正在重試')
                  scheduleRetry()
               }
            })
            // Rejoin with the newly checked role; a revoked editor can become a viewer.
            await refresh()
         } catch {
            if (!disposed && !denied) {
               setRealtime('即時更新中斷，正在重試')
               scheduleRetry()
            }
         } finally {
            connecting = false
         }
      }

      function resume() {
         if (document.visibilityState === 'hidden') return
         void refresh()
         void connect()
      }
      void refresh()
      void connect()
      const renewal = setInterval(() => {
         void connect()
      }, 20_000)
      const reconciliation = setInterval(() => {
         void refresh()
      }, 5000)
      window.addEventListener('online', resume)
      document.addEventListener('visibilitychange', resume)
      return () => {
         disposed = true
         controller.abort()
         realtimeAccessToken = null
         clearInterval(renewal)
         clearInterval(reconciliation)
         if (retry) clearTimeout(retry)
         window.removeEventListener('online', resume)
         document.removeEventListener('visibilitychange', resume)
         if (channel) void client.removeChannel(channel)
         client.realtime.disconnect()
         read.current = async () => {}
      }
   }, [documentId, shareToken, attempt])

   return { data, error, setError, realtime, reload, reconnect }
}
