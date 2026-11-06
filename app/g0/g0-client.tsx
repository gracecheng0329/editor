'use client'

import dynamic from 'next/dynamic'

const G0Canvas = dynamic(() => import('./g0-canvas'), {
   ssr: false,
   loading: () => <p>正在載入 G0 畫布…</p>,
})

export function G0Client() {
   return <G0Canvas />
}
