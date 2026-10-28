export const instant = false;
import Link from 'next/link';
import { DocumentShell } from './ui';
export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="product-page"><nav className="product-nav"><Link href="/documents" className="product-brand">← 我的文件</Link><form action="/auth/logout" method="post"><button className="plain-button">登出</button></form></nav><DocumentShell id={id} /></main>;
}
