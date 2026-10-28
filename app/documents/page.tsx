export const instant = false;
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { DocumentList } from './ui';

export default async function Documents({ searchParams }: { searchParams: Promise<{ logout?: string }> }) {
  const { logout } = await searchParams;
  let user = null;
  let unavailable = false;
  try {
    const client = await createClient();
    const result = await client.auth.getUser();
    user = result.data.user;
    if (result.error && result.error.name !== 'AuthSessionMissingError') unavailable = true;
  } catch { unavailable = true; }
  return <main className="product-page"><nav className="product-nav"><Link href="/" className="product-brand">◈ Archly</Link>{user && <form action="/auth/logout" method="post"><button className="plain-button">登出</button></form>}</nav>
    <section className="document-content"><p className="eyebrow">YOUR WORKSPACE</p><h1>我的文件</h1>
      {logout === 'failed' && <p role="alert" className="notice">登出未完成，請再試一次。</p>}
      {unavailable ? <p role="alert">服務暫時無法使用，請重新整理再試。</p> : user ? <DocumentList /> : <p>登入後即可建立及管理私密文件。 <a href="/auth/login?next=%2Fdocuments">使用 GitHub 登入</a></p>}
    </section></main>;
}
