'use client'
import { useCallback, useEffect, useState } from 'react'

type Settings = { enabled: boolean; editors: { user_id: string }[] }
export function AccessSettings({ id }: { id: string }) {
   const [settings, setSettings] = useState<Settings | null>(null)
   const [userId, setUserId] = useState('')
   const [link, setLink] = useState('')
   const [error, setError] = useState('')
   const [busy, setBusy] = useState(false)
   const path = `/api/documents/${encodeURIComponent(id)}`
   const load = useCallback(async () => {
      const response = await fetch(`${path}/editors`, { cache: 'no-store' })
      if (!response.ok) throw new Error('無法載入存取設定，請再試一次。')
      setSettings(await response.json())
   }, [path])
   useEffect(() => {
      void Promise.resolve()
         .then(load)
         .catch(() => setError('無法載入存取設定，請再試一次。'))
   }, [load])
   async function change(action: 'share' | 'disable' | 'invite' | 'revoke', editorId?: string) {
      setBusy(true)
      setError('')
      try {
         let endpoint: string
         if (action === 'share' || action === 'disable') endpoint = `${path}/share`
         else if (action === 'invite') endpoint = `${path}/editors`
         else {
            if (!editorId) throw new Error('缺少編輯者 ID。')
            endpoint = `${path}/editors/${encodeURIComponent(editorId)}`
         }
         const response = await fetch(endpoint, {
            method: action === 'disable' || action === 'revoke' ? 'DELETE' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            ...(action === 'invite' ? { body: JSON.stringify({ userId: userId.trim() }) } : {}),
         })
         if (!response.ok)
            throw new Error(
               response.status === 422
                  ? '無法邀請，請確認對方已完成 GitHub 登入，並貼上正確的協作邀請 ID。'
                  : '操作未完成，請再試一次。',
            )
         if (action === 'share') {
            const result = await response.json()
            setLink(`${window.location.origin}/share#${result.token}`)
         }
         if (action === 'disable') setLink('')
         if (action === 'invite') setUserId('')
         await load()
      } catch (failure) {
         setError(failure instanceof Error ? failure.message : '操作未完成，請再試一次。')
      } finally {
         setBusy(false)
      }
   }
   return (
      <section aria-label='文件存取設定'>
         <h2>分享與編輯者</h2>
         {error && (
            <p role='alert'>
               {error}{' '}
               <button
                  type='button'
                  className='plain-button'
                  onClick={() =>
                     void load()
                        .then(() => setError(''))
                        .catch(() => setError('無法載入存取設定，請再試一次。'))
                  }
               >
                  重新載入設定
               </button>
            </p>
         )}
         {settings && (
            <>
               <p>
                  {settings.enabled
                     ? '觀看連結已啟用。重新產生會立即使舊連結失效。'
                     : '尚未啟用觀看連結。'}
               </p>
               <button
                  type='button'
                  className='primary-button'
                  disabled={busy}
                  onClick={() => void change('share')}
               >
                  {settings.enabled ? '重新產生觀看連結' : '啟用觀看連結'}
               </button>
               {settings.enabled && (
                  <button
                     type='button'
                     className='plain-button'
                     disabled={busy}
                     onClick={() => void change('disable')}
                  >
                     撤銷觀看連結
                  </button>
               )}
               {link && (
                  <p>
                     <label htmlFor='share-link'>觀看連結</label>
                     <input
                        id='share-link'
                        readOnly
                        value={link}
                        onFocus={(event) => event.target.select()}
                     />
                     <small>請複製保存；這份完整連結只在產生時顯示。</small>
                  </p>
               )}
               <form
                  className='document-form'
                  onSubmit={(event) => {
                     event.preventDefault()
                     void change('invite')
                  }}
               >
                  <label htmlFor='editor-invite'>編輯者的協作邀請 ID</label>
                  <p>請對方完成 GitHub 登入，從「我的文件」複製自己的協作邀請 ID。</p>
                  <div>
                     <input
                        id='editor-invite'
                        value={userId}
                        onChange={(event) => setUserId(event.target.value)}
                     />
                     <button type='submit' className='primary-button' disabled={busy}>
                        授予編輯資格
                     </button>
                  </div>
               </form>
               <ul>
                  {settings.editors.map((editor) => (
                     <li key={editor.user_id}>
                        <span>{editor.user_id}</span>{' '}
                        <button
                           type='button'
                           className='plain-button'
                           disabled={busy}
                           onClick={() => void change('revoke', editor.user_id)}
                        >
                           撤銷編輯資格
                        </button>
                     </li>
                  ))}
               </ul>
            </>
         )}
      </section>
   )
}
