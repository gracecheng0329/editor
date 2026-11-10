export const instant = false

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
   return <DocumentShell id={id} userName={user ? userDisplayName(user) : ''} />
}
