'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { SharedSyncCanvas } from '@/app/documents/[id]/sync-canvas'

type ViewerDocument = { id: string; title: string; role: 'viewer' }
type ResolvedShare = { document: ViewerDocument; token: string }

export function ShareReader() {
   const [share, setShare] = useState<ResolvedShare | null>(null)
   const [error, setError] = useState('')
   const [loading, setLoading] = useState(true)
   const load = useCallback(async () => {
      setShare(null)
      setError('')
      setLoading(true)
      try {
         const token = window.location.hash.slice(1)
         const response = await fetch('/api/share/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
            cache: 'no-store',
         })
         if (!response.ok) {
            setError(
               response.status === 404
                  ? '分享連結無效或已撤銷。'
                  : '無法載入分享文件，請再試一次。',
            )
            setLoading(false)
            return
         }
         setShare({ document: await response.json(), token })
         setLoading(false)
      } catch {
         setError('無法載入分享文件，請再試一次。')
         setLoading(false)
      }
   }, [])
   useEffect(() => {
      void Promise.resolve().then(load)
      window.addEventListener('hashchange', load)
      return () => window.removeEventListener('hashchange', load)
   }, [load])

   if (share)
      return (
         <main className='formal-workspace'>
            <SharedSyncCanvas
               key={`${share.document.id}:${share.token}`}
               documentId={share.document.id}
               shareToken={share.token}
               title={share.document.title}
            />
         </main>
      )
   return (
      <main className='product-page'>
         <nav className='product-nav'>
            <Link href='/' className='product-brand'>◈ Archly</Link>
            <Link href='/documents'>我的文件</Link>
         </nav>
         <section className='document-content'>
            {loading && <p role='status'>正在驗證分享連結…</p>}
            {error && <p role='alert'>{error}</p>}
            <button type='button' className='plain-button' onClick={() => void load()}>
               重新驗證連結
            </button>
         </section>
      </main>
   )
}
