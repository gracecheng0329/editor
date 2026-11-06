'use client'

import { Tldraw } from 'tldraw'
import 'tldraw/tldraw.css'
import { architectureShapeUtils } from './architecture-shape'
import { seedCanvas } from './seed'
import { WorkspaceUi } from './workspace-ui'

export default function Whiteboard() {
   return (
      <main className='whiteboard-app' aria-label='Archly 架構白板'>
         <Tldraw
            persistenceKey='archly-local-canvas-v1'
            shapeUtils={architectureShapeUtils}
            onMount={seedCanvas}
            hideUi
         >
            <WorkspaceUi />
         </Tldraw>
      </main>
   )
}
