import { notFound } from 'next/navigation'
import { G0Client } from './g0-client'

export default function G0Page() {
   if (process.env.NODE_ENV !== 'development' || process.env.G0_ENABLED !== '1') {
      notFound()
   }
   return <G0Client />
}
