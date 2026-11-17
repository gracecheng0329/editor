import { createHash, createHmac, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { createClient } from '@supabase/supabase-js'

const root = new URL('../', import.meta.url).pathname
const credentials = JSON.parse(
   readFileSync(
      process.env.S1_CREDENTIALS_FILE ?? `${root}.local-supabase/credentials.json`,
      'utf8',
   ),
)
const url = 'http://127.0.0.1:54321'
const port = 8791
const anon = createClient(url, credentials.anonKey, { auth: { persistSession: false } })
const admin = createClient(url, credentials.serviceKey, { auth: { persistSession: false } })
let closed = false

const page = `<!doctype html>
<html lang="zh-Hant">
<meta charset="utf-8">
<title>S4 Realtime authorization harness</title>
<h1>S4 Realtime authorization harness</h1>
<output aria-label="訂閱狀態">尚未連線</output>
<ol aria-label="收到的事件"></ol>
<script id="s4-config" data-url="${url}" data-anon-key="${credentials.anonKey}"></script>
<script src="/client.js"></script>
</html>`

const testClient = await build({
   absWorkingDir: root,
   entryPoints: ['tests/s4/realtime-browser-client.ts'],
   bundle: true,
   format: 'iife',
   platform: 'browser',
   write: false,
})

function psql(sql) {
   const result = spawnSync(
      'container',
      [
         'exec',
         '--interactive',
         'editor-supabase-db',
         'psql',
         '-U',
         'supabase_admin',
         '-d',
         'postgres',
         '-v',
         'ON_ERROR_STOP=1',
      ],
      { input: sql, encoding: 'utf8' },
   )
   if (result.status !== 0)
      throw new Error(`Could not configure the temporary Realtime probe: ${result.stderr.trim()}`)
}

function sqlIdentifierSafe() {
   return `create table if not exists public.s4_realtime_probe_comments (
      id uuid primary key,
      document_id uuid not null,
      revision bigint not null,
      body text not null
   );
   alter table public.s4_realtime_probe_comments enable row level security;
   revoke all on public.s4_realtime_probe_comments from public, anon, authenticated;
   grant all on public.s4_realtime_probe_comments to service_role;

   create or replace function public.s4_can_subscribe_document() returns boolean
   language sql stable security definer set search_path = '' as $$
     select case auth.jwt() ->> 'document_role'
       when 'viewer' then exists (
         select 1 from private.document_shares
         where document_id = ((select auth.jwt()) ->> 'document_id')::uuid
           and token_hash = decode((select auth.jwt()) ->> 'share_hash', 'hex')
       )
       when 'owner' then public.document_session_active() and exists (
         select 1 from public.documents
         where id = ((select auth.jwt()) ->> 'document_id')::uuid
           and owner_id = (select auth.uid())
       )
       when 'editor' then public.document_session_active() and exists (
         select 1 from private.document_editors
         where document_id = ((select auth.jwt()) ->> 'document_id')::uuid
           and user_id = (select auth.uid())
       )
       else false
     end;
   $$;
   revoke all on function public.s4_can_subscribe_document() from public, anon;
   grant execute on function public.s4_can_subscribe_document() to authenticated;
   drop policy if exists s4_private_document_broadcast on realtime.messages;
   create policy s4_private_document_broadcast on realtime.messages
     for select to authenticated
     using (
       realtime.topic() = 's4-document:' || ((select auth.jwt()) ->> 'document_id')
       and public.s4_can_subscribe_document()
     );

   create or replace function public.s4_publish_probe_comment(
     target_doc uuid, target_id uuid, target_body text
   ) returns jsonb language plpgsql security definer set search_path = '' as $$
   declare next_revision bigint;
   begin
     insert into public.s4_realtime_probe_comments(id, document_id, revision, body)
     values (target_id, target_doc, 1, target_body)
     on conflict (id) do update set
       revision = public.s4_realtime_probe_comments.revision + 1,
       body = excluded.body
     returning revision into next_revision;
     perform realtime.send(
       payload => jsonb_build_object('id', target_id, 'revision', next_revision),
       event => 'comment_changed',
       topic => 's4-document:' || target_doc::text,
       private => true
     );
     return jsonb_build_object('id', target_id, 'revision', next_revision);
   end;
   $$;
   revoke all on function public.s4_publish_probe_comment(uuid, uuid, text) from public, anon, authenticated;
   grant execute on function public.s4_publish_probe_comment(uuid, uuid, text) to service_role;
   notify pgrst, 'reload schema';`
}

function cleanup() {
   if (closed) return
   psql(`drop policy if exists s4_private_document_broadcast on realtime.messages;
      drop function if exists public.s4_can_subscribe_document();
      drop function if exists public.s4_publish_probe_comment(uuid, uuid, text);
      drop table if exists public.s4_realtime_probe_comments;`)
   closed = true
}

function send(response, status, value) {
   response.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
   })
   response.end(JSON.stringify(value))
}

async function body(request) {
   let raw = ''
   for await (const chunk of request) {
      raw += chunk
      if (raw.length > 32_000) throw new Error('Request body too large')
   }
   return raw ? JSON.parse(raw) : {}
}

function bearer(request) {
   const match = /^Bearer\s+(.+)$/i.exec(request.headers.authorization ?? '')
   return match?.[1] ?? null
}

function decodePayload(jwt) {
   try {
      return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'))
   } catch {
      return {}
   }
}

function signJwt(payload) {
   const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
   const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
   const input = `${header}.${encoded}`
   return `${input}.${createHmac('sha256', credentials.jwtSecret).update(input).digest('base64url')}`
}

async function access(documentId, shareToken, accessToken) {
   let user = null
   let sessionId = null
   if (accessToken) {
      const result = await admin.auth.getUser(accessToken)
      if (result.error || !result.data.user) return null
      user = result.data.user
      const claims = decodePayload(accessToken)
      sessionId = claims.session_id
      const signedIn = createClient(url, credentials.anonKey, {
         auth: { persistSession: false },
         global: { headers: { Authorization: `Bearer ${accessToken}` } },
      })
      const active = await signedIn.rpc('document_session_active')
      if (active.error || active.data !== true) return null
      const owner = await admin
         .from('documents')
         .select('owner_id')
         .eq('id', documentId)
         .maybeSingle()
      if (!owner.error && owner.data?.owner_id === user.id)
         return { user, sessionId, role: 'owner', shareHash: null }
      const editor = await signedIn.rpc('is_document_editor', { target_id: documentId })
      if (!editor.error && editor.data === true)
         return { user, sessionId, role: 'editor', shareHash: null }
   }

   if (shareToken?.length !== 43) return null
   const resolved = await anon.rpc('resolve_document_share', { share_token: shareToken })
   if (resolved.error || resolved.data?.id !== documentId) return null
   return {
      user,
      sessionId,
      role: 'viewer',
      shareHash: createHash('sha256').update(shareToken).digest('hex'),
   }
}

function ticket(identity, documentId, expired = false) {
   const now = Math.floor(Date.now() / 1000)
   const exp = expired ? now - 30 : now + (identity.role === 'viewer' ? 45 : 300)
   const payload = {
      iss: 'supabase',
      aud: 'authenticated',
      role: 'authenticated',
      sub: identity.user?.id ?? randomUUID(),
      iat: now,
      exp,
      document_id: documentId,
      document_role: identity.role,
   }
   if (identity.role !== 'viewer') payload.session_id = identity.sessionId
   if (identity.shareHash) payload.share_hash = identity.shareHash
   return { accessToken: signJwt(payload), expiresAt: exp * 1000, role: identity.role }
}

async function handler(request, response) {
   const requestUrl = new URL(request.url, `http://127.0.0.1:${port}`)
   if (request.method === 'GET' && requestUrl.pathname === '/health') {
      response.writeHead(200)
      response.end('ok')
      return
   }
   if (request.method === 'POST' && requestUrl.pathname === '/api/cleanup') {
      cleanup()
      response.writeHead(204)
      response.end()
      return
   }
   if (request.method === 'GET' && requestUrl.pathname === '/') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(page)
      return
   }
   if (request.method === 'GET' && requestUrl.pathname === '/client.js') {
      response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' })
      response.end(testClient.outputFiles[0].text)
      return
   }
   if (request.method === 'POST' && requestUrl.pathname === '/api/ticket') {
      const input = await body(request)
      if (!/^[0-9a-f-]{36}$/i.test(input.documentId ?? '')) {
         send(response, 400, { error: 'invalid_document' })
         return
      }
      const identity = await access(input.documentId, input.shareToken, bearer(request))
      if (!identity) {
         send(response, 403, { error: 'document_access_denied' })
         return
      }
      send(response, 200, {
         documentId: input.documentId,
         ...ticket(identity, input.documentId, input.expired === true),
      })
      return
   }
   if (request.method === 'GET' && requestUrl.pathname === '/api/content') {
      const documentId = requestUrl.searchParams.get('documentId') ?? ''
      const commentId = requestUrl.searchParams.get('commentId') ?? ''
      const shareToken = requestUrl.searchParams.get('shareToken') ?? ''
      const identity = await access(documentId, shareToken, bearer(request))
      if (!identity) {
         send(response, 403, { error: 'document_access_denied' })
         return
      }
      const result = await admin
         .from('s4_realtime_probe_comments')
         .select('id, document_id, revision, body')
         .eq('document_id', documentId)
         .eq('id', commentId)
         .maybeSingle()
      if (result.error) {
         send(response, 500, { error: 'content_read_failed' })
         return
      }
      send(response, result.data ? 200 : 404, result.data ?? { error: 'content_not_found' })
      return
   }
   if (request.method === 'POST' && requestUrl.pathname === '/api/publish') {
      const input = await body(request)
      const identity = await access(input.documentId, '', bearer(request))
      if (!identity || !['owner', 'editor'].includes(identity.role)) {
         send(response, 403, { error: 'editor_access_required' })
         return
      }
      if (typeof input.body !== 'string' || input.body.length < 1 || input.body.length > 2000) {
         send(response, 400, { error: 'invalid_content' })
         return
      }
      const result = await admin.rpc('s4_publish_probe_comment', {
         target_doc: input.documentId,
         target_id: input.commentId,
         target_body: input.body,
      })
      if (result.error) {
         send(response, 500, { error: 'publish_failed' })
         return
      }
      send(response, 200, result.data)
      return
   }
   send(response, 404, { error: 'not_found' })
}

psql(sqlIdentifierSafe())
const server = createServer((request, response) => {
   void handler(request, response).catch(() => send(response, 500, { error: 'request_failed' }))
})
server.listen(port, '127.0.0.1', () =>
   console.log(`S4 harness listening on http://127.0.0.1:${port}`),
)
for (const signal of ['SIGINT', 'SIGTERM']) {
   process.once(signal, () => {
      try {
         cleanup()
      } catch (error) {
         console.error(error)
         process.exitCode = 1
      }
      server.close()
      server.closeAllConnections()
   })
}
