import { useSync } from '@tldraw/sync'
import { createRoot } from 'react-dom/client'
import { createShapeId, useValue } from 'tldraw'
import { canvasSchema } from '../../../packages/canvas/schema'

const { documentId, shareToken, title } = JSON.parse(
   decodeURIComponent(location.hash.slice(1)),
) as {
   documentId: string
   shareToken: string
   title: string
}
const assets = {
   upload: async (): Promise<never> => {
      throw new Error('No probe assets')
   },
}
async function uri() {
   const base = `http://127.0.0.1:8789/documents/${documentId}`
   const response = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'X-Share-Token': shareToken },
   })
   if (!response.ok) throw new Error('Probe authorization failed')
   const { ticket } = await response.json()
   return `${base.replace('http:', 'ws:')}?ticket=${encodeURIComponent(ticket)}`
}

function Probe() {
   const sync = useSync({ uri, assets, schema: canvasSchema })
   const store = sync.status === 'synced-remote' ? sync.store : null
   const nodes = useValue(
      'probe nodes',
      () =>
         store?.query
            .records('shape')
            .get()
            .filter((shape) => shape.type === 'architecture-node') ?? [],
      [store],
   )
   return (
      <>
         <output aria-label='Probe nodes'>
            {nodes.map((node) => String(node.props.title)).join(',')}
         </output>
         <button
            type='button'
            disabled={!store || nodes.length === 0}
            onClick={() => {
               const source = nodes[0]
               if (!store || !source) throw new Error('Expected a synchronized source node')
               // Public store mutation deliberately bypasses the product's readonly UI.
               store.put([{ ...source, id: createShapeId(), props: { ...source.props, title } }])
            }}
         >
            Attempt write
         </button>
      </>
   )
}
const root = document.getElementById('root')
if (!root) throw new Error('Missing probe root')
createRoot(root).render(<Probe />)
