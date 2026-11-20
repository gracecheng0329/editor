export type Point = { x: number; y: number }
export type CommentMessage = {
   id: string
   authorId: string | null
   author: string
   body: string
   mentions: { id: string; name: string }[]
   createdAt: string
}
export type CommentAnchor =
   | { type: 'world'; x: number; y: number }
   | {
        type: 'object'
        objectId: string
        offset: Point
        world: Point
        exists: boolean
     }
export type CommentThread = {
   id: string
   revision: number
   status: 'open' | 'resolved'
   resolvedBy: string | null
   resolvedAt: string | null
   canResolve: boolean
   createdAt: string
   anchor: CommentAnchor
   messages: CommentMessage[]
}
export type CommentList = {
   role: 'owner' | 'editor' | 'viewer'
   canWrite: boolean
   participants: { id: string; name: string }[]
   threads: CommentThread[]
}
