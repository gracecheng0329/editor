export const instant = false

import Link from 'next/link'
import { connection } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { userDisplayName } from '@/lib/user-display-name'
import { DocumentList } from './ui'

export default async function Documents({
   searchParams,
}: {
   searchParams: Promise<{ logout?: string }>
}) {
   await connection()
   const { logout } = await searchParams
   let user = null
   let unavailable = false
   try {
      const client = await createClient()
      const result = await client.auth.getUser()
      user = result.data.user
      if (result.error && result.error.name !== 'AuthSessionMissingError') unavailable = true
   } catch {
      unavailable = true
   }
   return (
      <main className='product-page'>
         <nav className='product-nav'>
            <Link href='/' className='product-brand'>
               ◈ Archly
            </Link>
            {user && (
               <form action='/auth/logout' method='post'>
                  <button type='submit' className='plain-button'>
                     登出
                  </button>
               </form>
            )}
         </nav>
         <section className='document-content'>
            <p className='eyebrow'>YOUR WORKSPACE</p>
            <h1>我的文件</h1>
            {logout === 'failed' && (
               <p role='alert' className='notice'>
                  登出未完成，請再試一次。
               </p>
            )}
            {unavailable ? (
               <p role='alert'>服務暫時無法使用，請重新整理再試。</p>
            ) : user ? (
               <>
                  <p>已登入：{userDisplayName(user)}</p>
                  <details>
                     <summary>協作邀請</summary>
                     <label htmlFor='invitation-id'>協作邀請 ID</label>
                     <input id='invitation-id' value={user.id} readOnly />
                     <p>將此 ID 複製給文件擁有者，即可邀請已完成 GitHub 登入的你成為編輯者。</p>
                  </details>
                  <DocumentList />
               </>
            ) : (
               <p>
                  登入後即可建立及管理私密文件。{' '}
                  <a href='/auth/login?next=%2Fdocuments'>使用 GitHub 登入</a>
               </p>
            )}
         </section>
      </main>
   )
}
