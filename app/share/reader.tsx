'use client'
import { useCallback, useEffect, useState } from 'react'

type ViewerDocument = { id: string; title: string; role: 'viewer' }
export function ShareReader() {
   const [document, setDocument] = useState<ViewerDocument | null>(null)
   const [error, setError] = useState('')
   const load = useCallback(async () => {
      try {
         const token = window.location.hash.slice(1)
         const response = await fetch('/api/share/resolve', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
            cache: 'no-store',
         })
         if (!response.ok) {
            setDocument(null)
            setError(
               response.status === 404
                  ? '分享連結無效或已撤銷。'
                  : '無法載入分享文件，請再試一次。',
            )
            return
         }
         setDocument(await response.json())
         setError('')
      } catch {
         setDocument(null)
         setError('無法載入分享文件，請再試一次。')
      }
   }, [])
   useEffect(() => {
      void Promise.resolve().then(load)
      window.addEventListener('hashchange', load)
      return () => window.removeEventListener('hashchange', load)
   }, [load])
   return (
      <section className='document-content'>
         {error && <p role='alert'>{error}</p>}
         {document && (
            <>
               <p className='eyebrow'>觀看者・唯讀</p>
               <h1>{document.title}</h1>
               <p>此連結提供觀看資格，登入後仍須獲擁有者邀請才能編輯。</p>
               <div className='canvas-placeholder'>
                  <strong>畫布</strong>
                  <p>畫布閱讀功能將於後續切片提供。</p>
               </div>
            </>
         )}
         <button type='button' className='plain-button' onClick={() => void load()}>
            重新驗證連結
         </button>
      </section>
   )
}
