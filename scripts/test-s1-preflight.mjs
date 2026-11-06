import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { preflight } from './s1-preflight.mjs'

test('preflight checks public deployment boundaries and refuses broken OAuth configuration', async (t) => {
   let mode = 'ok'
   const server = createServer((req, res) => {
      const base = `http://127.0.0.1:${server.address().port}`
      const url = new URL(req.url, base)
      if (url.pathname === '/') return res.end('使用 GitHub 登入')
      if (url.pathname === '/api/documents') {
         res.writeHead(mode === 'anonymous-access' ? 200 : 401, {
            'Content-Type': 'application/json',
         })
         if (mode === 'invalid-json') return res.end('private-response-detail')
         return res.end(JSON.stringify({ error: 'UNAUTHENTICATED' }))
      }
      if (url.pathname === '/auth/callback') {
         res.writeHead(307, { location: `${base}/?auth=failed` })
         return res.end()
      }
      if (url.pathname === '/auth/login') {
         const location = new URL('/auth/v1/authorize', base)
         location.search = new URLSearchParams({
            provider: 'github',
            redirect_to: `${base}/auth/callback`,
            code_challenge_method: 's256',
            code_challenge: 'a'.repeat(43),
         }).toString()
         res.writeHead(307, {
            location: mode === 'login-failure' ? `${base}/?auth=failed` : location.href,
         })
         return res.end()
      }
      if (url.pathname === '/auth/v1/authorize') {
         if (mode === 'disabled-provider') {
            res.writeHead(400)
            return res.end('provider disabled')
         }
         const location = new URL('https://github.com/login/oauth/authorize')
         location.search = new URLSearchParams({
            client_id: 'fixture-client',
            redirect_uri:
               mode === 'wrong-callback'
                  ? 'https://wrong.example/callback'
                  : `${base}/auth/v1/callback`,
         }).toString()
         res.writeHead(302, { location: location.href })
         return res.end()
      }
      res.writeHead(404)
      res.end()
   })
   await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
   t.after(() => new Promise((resolve) => server.close(resolve)))
   const base = `http://127.0.0.1:${server.address().port}`
   assert.equal((await preflight(base, base)).length, 5)
   for (const failure of [
      'anonymous-access',
      'login-failure',
      'disabled-provider',
      'wrong-callback',
      'invalid-json',
   ]) {
      mode = failure
      await assert.rejects(preflight(base, base), /failed/)
   }
   await assert.rejects(
      preflight('https://user:password@app.example', base),
      /without a path or credentials/,
   )
   await assert.rejects(preflight('http://public.example', base), /HTTPS/)
})
