export const instant = false

import Link from 'next/link'

export default async function Home({ searchParams }: { searchParams: Promise<{ auth?: string }> }) {
   const { auth } = await searchParams
   return (
      <main className='product-page'>
         <nav className='product-nav'>
            <Link href='/' className='product-brand'>
               ◈ Archly
            </Link>
            <Link href='/documents'>我的文件</Link>
         </nav>
         <section className='hero'>
            <p className='eyebrow'>ARCHITECTURE, TOGETHER</p>
            <h1>把想法連成架構。</h1>
            <p>用一份白板整理系統設計，為團隊討論留下清楚的起點。</p>
            {auth === 'failed' && (
               <div role='alert' className='notice'>
                  登入未完成，請再試一次。 <a href='/auth/login'>重新登入</a>
               </div>
            )}
            <a className='primary-button' href='/auth/login'>
               使用 GitHub 登入
            </a>
            <Link className='text-link' href='/documents'>
               前往我的文件 →
            </Link>
         </section>
         <section className='product-features'>
            <div>
               <strong>建立文件</strong>
               <p>為每個架構構想建立私密文件。</p>
            </div>
            <div>
               <strong>整理想法</strong>
               <p>以節點、連線與手繪呈現系統。</p>
            </div>
            <div>
               <strong>共同討論</strong>
               <p>讓團隊圍繞同一份架構展開討論。</p>
            </div>
         </section>
      </main>
   )
}
