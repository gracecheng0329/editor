import Link from 'next/link';
import { ShareReader } from './reader';

export default function SharePage() {
  return <main className="product-page"><nav className="product-nav"><Link href="/" className="product-brand">◈ Archly</Link><Link href="/documents">我的文件</Link></nav><ShareReader /></main>;
}
