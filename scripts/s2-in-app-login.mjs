import { randomBytes, timingSafeEqual } from 'node:crypto'
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { createServerClient } from '@supabase/ssr'

process.loadEnvFile('.s2-remote/local-frontend.env')
const origin = 'http://127.0.0.1:3104'
const appOrigin = 'http://127.0.0.1:3103'
const supabase = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL)
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (process.env.S2_LOCAL_FRONTEND !== '1' || process.env.S2_APP_ORIGIN !== appOrigin || !key) {
   throw new Error('Expected the private local frontend acceptance configuration')
}
const cookiePrefix = `sb-${supabase.hostname.split('.')[0]}-auth-token`
const cookieName = new RegExp(`^${cookiePrefix}(?:\\.\\d+)?$`)
const csrf = randomBytes(32).toString('hex')
const directory = '.s2-remote'
mkdirSync(directory, { recursive: true, mode: 0o700 })

function identities() {
   try {
      return JSON.parse(readFileSync(`${directory}/captured-identities.json`, 'utf8'))
   } catch (error) {
      if (error.code === 'ENOENT') return {}
      throw error
   }
}
function save(path, value) {
   writeFileSync(path, JSON.stringify(value, null, 2), { mode: 0o600 })
   chmodSync(path, 0o600)
}
function cookies(request) {
   return new Map(
      (request.headers.cookie ?? '').split(';').flatMap((part) => {
         const separator = part.indexOf('=')
         const name = part.slice(0, separator).trim()
         return separator > 0 && cookieName.test(name)
            ? [[name, part.slice(separator + 1).trim()]]
            : []
      }),
   )
}
function page(message = '') {
   const ids = identities()
   return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>S2 測試帳號登入</title>
<style>body{font:17px system-ui;max-width:760px;margin:48px auto;padding:24px;line-height:1.6}button,a{display:inline-block;margin:8px;padding:10px 16px}output{display:block}</style>
<h1>S2 測試帳號登入</h1><p>這是本機驗收工具。登入與切換帳號都在 GPT 內完成，不會開啟外部視窗。</p>
<p>先到本機前端完成 GitHub 登入，再回到此頁保存該帳號。</p>
<a href="${appOrigin}/documents">前往本機文件頁登入</a>
<form method="post" action="/capture/owner"><input type="hidden" name="csrf" value="${csrf}"><button>保存 owner session</button></form>
<form method="post" action="/capture/editor"><input type="hidden" name="csrf" value="${csrf}"><button>保存 editor session</button></form>
<form method="post" action="/clear-local-session"><input type="hidden" name="csrf" value="${csrf}"><button>清除本機頁面的登入 Cookie，以切換下一個帳號</button></form>
<p>此按鈕只清除本機 Cookie，保留已保存的 Supabase session；不要按產品的「登出」，以免撤銷第一個測試帳號的 session。</p>
<output>Owner：${ids.owner ? '已保存' : '尚未保存'}；Editor：${ids.editor ? '已保存' : '尚未保存'}</output>
<p role="status">${message}</p></html>`
}
const server = createServer(async (request, response) => {
   response.setHeader('Cache-Control', 'private, no-store')
   response.setHeader('X-Frame-Options', 'DENY')
   response.setHeader('Content-Type', 'text/html; charset=utf-8')
   if (request.headers.host !== '127.0.0.1:3104') {
      response.writeHead(403).end('Forbidden')
      return
   }
   const path = new URL(request.url, origin).pathname
   if (request.method === 'GET' && path === '/') {
      response.end(page())
      return
   }
   if (request.method !== 'POST' || request.headers.origin !== origin) {
      response.writeHead(403).end('Forbidden')
      return
   }
   try {
      let body = ''
      for await (const chunk of request) {
         body += chunk.toString()
         if (body.length > 1024) {
            response.writeHead(413).end('Too large')
            return
         }
      }
      const supplied = new URLSearchParams(body).get('csrf') ?? ''
      if (
         supplied.length !== csrf.length ||
         !timingSafeEqual(Buffer.from(supplied), Buffer.from(csrf))
      ) {
         response.writeHead(403).end('Forbidden')
         return
      }
      const values = cookies(request)
      if (path === '/clear-local-session') {
         response.setHeader(
            'Set-Cookie',
            [...values.keys()].map((name) => `${name}=; Path=/; Max-Age=0; SameSite=Lax`),
         )
         response.end(page('本機 Cookie 已清除。請切換 GitHub 帳號，再登入本機文件頁。'))
         return
      }
      const role = /^\/capture\/(owner|editor)$/.exec(path)?.[1]
      if (!role) {
         response.writeHead(404).end('Not found')
         return
      }
      const client = createServerClient(supabase.origin, key, {
         cookies: {
            getAll: () => [...values].map(([name, value]) => ({ name, value })),
            setAll: (updates) =>
               updates.forEach(({ name, value }) => {
                  if (value) values.set(name, value)
                  else values.delete(name)
               }),
         },
      })
      const { data, error } = await client.auth.getUser()
      if (error || !data.user) {
         response.writeHead(401).end(page('請先完成本機文件頁的 GitHub 登入。'))
         return
      }
      const ids = identities()
      const peer = role === 'owner' ? 'editor' : 'owner'
      if (ids[peer]?.id === data.user.id) {
         response
            .writeHead(409)
            .end(page('這是同一個帳號，不能當作另一位協作者。請切換 GitHub 帳號。'))
         return
      }
      save(`${directory}/${role}.json`, {
         cookies: [...values]
            .filter(([name]) => cookieName.test(name))
            .map(([name, value]) => ({
               name,
               value,
               domain: '127.0.0.1',
               path: '/',
               expires: -1,
               httpOnly: false,
               secure: false,
               sameSite: 'Lax',
            })),
         origins: [],
      })
      ids[role] = { id: data.user.id, origin: appOrigin, date: new Date().toISOString() }
      save(`${directory}/captured-identities.json`, ids)
      console.log(`Saved ${role} session privately after remote Auth verification.`)
      response.end(page(`${role} session 已保存，未在頁面顯示憑證。`))
   } catch {
      response.writeHead(503).end(page('驗證服務暫時不可用，請重試。'))
   }
})
server.listen(3104, '127.0.0.1', () => console.log(`In-app test login: ${origin}`))
