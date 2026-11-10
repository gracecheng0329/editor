'use client'
import { useCallback, useEffect, useState } from 'react'
import { ModalFrame } from '@/app/web/whiteboard/workspace-surfaces'
import { AccessSettings } from './access'
import { DocumentCanvas } from './canvas'

type Document = { title: string; role: 'owner' | 'editor' }
export function DocumentShell({ id, userName }: { id: string; userName: string }) {
   const [document, setDocument] = useState<Document | null>(null)
   const [title, setTitle] = useState('')
   const [error, setError] = useState('')
   const [saved, setSaved] = useState(false)
   const [sharing, setSharing] = useState(false)
   const closeSharing = useCallback(() => setSharing(false), [])
   const load = useCallback(async () => {
      try {
         const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
            cache: 'no-store',
         })
         if (!response.ok) {
            setDocument(null)
            setError(
               response.status === 404
                  ? '找不到文件。'
                  : response.status === 401
                    ? '請先登入。'
                    : '無法載入文件，請再試一次。',
            )
            return
         }
         const value: Document = await response.json()
         setDocument(value)
         setTitle(value.title)
         setError('')
      } catch {
         setDocument(null)
         setError('無法載入文件，請再試一次。')
      }
   }, [id])
   useEffect(() => {
      void Promise.resolve().then(load)
   }, [load])
   async function rename(event: React.FormEvent) {
      event.preventDefault()
      setSaved(false)
      setError('')
      try {
         const response = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title }),
         })
         if (!response.ok) {
            setError(response.status === 422 ? '請輸入文件標題。' : '儲存失敗，請再試一次。')
            return
         }
         const value: Document = await response.json()
         setDocument({ ...value, role: 'owner' })
         setTitle(value.title)
         setSaved(true)
      } catch {
         setError('儲存失敗，請再試一次。')
      }
   }
   if (!document)
      return (
         <main className='product-page'>
            <a href='/documents'>← 我的文件</a>
            <section className='document-content'>
               {error ? (
                  <p role='alert'>
                     {error}{' '}
                     <button type='button' onClick={() => void load()}>
                        重試
                     </button>
                  </p>
               ) : (
                  <p role='status'>正在載入文件…</p>
               )}
            </section>
         </main>
      )
   return (
      <main className='formal-workspace'>
         <DocumentCanvas
            id={id}
            workspace={{
               isSharing: sharing,
               userName,
               heading: (
                  <div className='document-heading'>
                     {document.role === 'owner' ? (
                        <form onSubmit={rename} className='workspace-title-form'>
                           <input
                              aria-label='文件標題'
                              value={title}
                              maxLength={200}
                              onChange={(event) => {
                                 setTitle(event.target.value)
                                 setSaved(false)
                              }}
                           />
                           <button
                              type='submit'
                              aria-label='儲存標題'
                              title='儲存標題'
                              disabled={title === document.title}
                           >
                              儲存
                           </button>
                        </form>
                     ) : (
                        <h1>{document.title}</h1>
                     )}
                     <span>
                        <span>{document.role === 'owner' ? '擁有者' : '編輯者'}</span> ·
                        私密協作文件
                     </span>
                     {saved && <output aria-label='標題儲存結果'>標題已儲存。</output>}
                     {error && <p role='alert'>{error}</p>}
                  </div>
               ),
               onShare: () => setSharing(true),
            }}
         />
         {sharing && (
            <ModalFrame title='分享與編輯者' onClose={closeSharing}>
               <div className='share-modal-body'>
                  {document.role === 'owner' ? (
                     <AccessSettings id={id} />
                  ) : (
                     <p>你具有編輯資格；分享與編輯者權限由擁有者管理。</p>
                  )}
               </div>
            </ModalFrame>
         )}
      </main>
   )
}
