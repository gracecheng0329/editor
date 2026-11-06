'use client'

import dynamic from 'next/dynamic'

const Whiteboard = dynamic(() => import('../web/whiteboard/whiteboard'), {
   ssr: false,
   loading: () => (
      <main className='board-loading'>
         <span className='brand-mark'>a</span>
         <p>正在準備你的畫布…</p>
      </main>
   ),
})

export default function Home() {
   return <Whiteboard />
}
