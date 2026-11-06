import type { TLStoreSnapshot } from '@tldraw/tlschema'

/** G0 public HTTP response, separate from the SDK's WebSocket protocol. */
export interface G0Checkpoint {
   id: string
   generation: number
   revision: number
   labels: string[]
   snapshot: TLStoreSnapshot
}
