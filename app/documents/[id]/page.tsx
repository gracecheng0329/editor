export const instant = false

import Link from 'next/link'
import { connection } from 'next/server'
import { identity } from '@/lib/documents'
import { userDisplayName } from '@/lib/user-display-name'
import { DocumentShell } from './ui'
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
   await connection()
   const { id } = await params
   const user = await identity()
      .then(({ user }) => user)
      .catch(() => null)
   return (
      <main className='product-page'>
         <nav className='product-nav'>
            <Link href='/documents' className='product-brand'>
               ← 我的文件
            </Link>
            <form action='/auth/logout' method='post' className='account-actions'>
               {user && <span>{userDisplayName(user)}</span>}
               <button type='submit' className='plain-button'>
                  登出
               </button>
            </form>
         </nav>
         <DocumentShell id={id} />
      </main>
   )
}
