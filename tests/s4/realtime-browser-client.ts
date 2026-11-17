import { createClient } from '@supabase/supabase-js'

declare global {
   interface Window {
      s4Realtime: {
         setIdentity: (accessToken: string | null) => void
         join: (input: {
            documentId: string
            shareToken?: string
            topic?: string
            expired?: boolean
         }) => Promise<{ status: number; expiresAt?: number; error?: string }>
         state: () => { status: string; closedAt: number | null }
      }
   }
}

const config = document.querySelector<HTMLScriptElement>('#s4-config')
const status = document.querySelector<HTMLOutputElement>('[aria-label="訂閱狀態"]')
const events = document.querySelector<HTMLOListElement>('[aria-label="收到的事件"]')
if (!config?.dataset.url || !config.dataset.anonKey || !status || !events)
   throw new Error('Realtime harness page is missing configuration')
const supabaseUrl = config.dataset.url
const anonKey = config.dataset.anonKey
const statusOutput = status
const eventList = events

let identityToken: string | null = null
let currentStatus = '尚未連線'
let closedAt: number | null = null
let removeActiveChannel: (() => Promise<unknown>) | null = null

function updateStatus(next: string) {
   currentStatus = next
   statusOutput.textContent = next
   if (['CHANNEL_ERROR', 'CLOSED', 'TIMED_OUT'].includes(next) && closedAt === null)
      closedAt = Date.now()
}

window.s4Realtime = {
   setIdentity(accessToken) {
      identityToken = accessToken
   },
   async join(input) {
      if (removeActiveChannel) await removeActiveChannel()
      removeActiveChannel = null
      closedAt = null
      updateStatus('取得訂閱授權中')
      const response = await fetch('/api/ticket', {
         method: 'POST',
         headers: {
            'content-type': 'application/json',
            ...(identityToken ? { authorization: `Bearer ${identityToken}` } : {}),
         },
         body: JSON.stringify(input),
      })
      const ticket = await response.json()
      if (!response.ok) {
         updateStatus('TICKET_DENIED')
         return { status: response.status, error: ticket.error }
      }

      const client = createClient(supabaseUrl, anonKey, {
         auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      })
      await client.realtime.setAuth(ticket.accessToken)
      const topic = input.topic ?? `s4-document:${input.documentId}`
      const channel = client
         .channel(topic, { config: { private: true } })
         .on('broadcast', { event: 'comment_changed' }, (message) => {
            const item = document.createElement('li')
            item.textContent = JSON.stringify(message.payload)
            eventList.append(item)
         })
         .subscribe((next) => updateStatus(next))
      removeActiveChannel = () => client.removeChannel(channel)
      return { status: response.status, expiresAt: ticket.expiresAt }
   },
   state: () => ({ status: currentStatus, closedAt }),
}
