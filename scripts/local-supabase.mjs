import { spawn } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localGithubOAuth } from './local-github-oauth.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const state = resolve(root, '.local-supabase')
const network = 'editor-supabase'
const names = ['db', 'mail', 'auth', 'rest', 'gateway', 'meta', 'studio']
const name = (service) => `editor-supabase-${service}`
const upstream = 'f9e0376951a1fdcc488c335ca2de4e4dc4da12e6'
const images = {
   db: 'docker.io/supabase/postgres:17.6.1.136',
   auth: 'docker.io/supabase/gotrue:v2.197.0',
   rest: 'docker.io/postgrest/postgrest:v14.18',
   gateway: 'docker.io/kong:2.8.1',
   meta: 'docker.io/supabase/postgres-meta:v0.100.0',
   studio: 'docker.io/supabase/studio:2026.10.12-sha-3699278',
   mail: 'docker.io/axllent/mailpit:v1.27.10',
}

function run(args, { input, capture = true, allowFailure = false } = {}) {
   return new Promise((accept, reject) => {
      const child = spawn('container', args, {
         stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout?.on('data', (chunk) => {
         stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
         stderr += chunk
      })
      child.on('error', reject)
      child.on('close', (code) => {
         if (code === 0 || allowFailure) accept({ code, stdout, stderr })
         else reject(new Error(`container ${args[0]} failed (${code}): ${stderr.trim()}`))
      })
      if (input !== undefined) child.stdin.end(input)
   })
}

async function privateFile(path, contents) {
   await writeFile(path, contents, { mode: 0o600 })
   await chmod(path, 0o600)
}

async function config() {
   await mkdir(state, { recursive: true, mode: 0o700 })
   const path = resolve(state, 'credentials.json')
   try {
      return JSON.parse(await readFile(path, 'utf8'))
   } catch (error) {
      if (error.code !== 'ENOENT') throw error
   }
   const secret = randomBytes(32).toString('hex')
   const jwt = (role) => {
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
      const payload = Buffer.from(
         JSON.stringify({
            role,
            iss: 'supabase',
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 10 * 365 * 86400,
         }),
      ).toString('base64url')
      const body = `${header}.${payload}`
      return `${body}.${createHmac('sha256', secret).update(body).digest('base64url')}`
   }
   const value = {
      password: randomBytes(24).toString('hex'),
      jwtSecret: secret,
      anonKey: jwt('anon'),
      serviceKey: jwt('service_role'),
      metaKey: randomBytes(32).toString('hex'),
   }
   await privateFile(path, `${JSON.stringify(value, null, 2)}\n`)
   return value
}

async function inspect(service) {
   const result = await run(['inspect', name(service)], { allowFailure: true })
   if (result.code !== 0) return null
   return JSON.parse(result.stdout)[0]
}

async function ip(service) {
   const info = await inspect(service)
   const address = info?.status?.networks?.[0]?.ipv4Address
   if (!address) throw new Error(`No IPv4 address for ${name(service)}`)
   return address.split('/')[0]
}

async function waitFor(description, probe) {
   const deadline = Date.now() + 120_000
   while (Date.now() < deadline) {
      try {
         if (await probe()) return
      } catch {
         /* service is starting */
      }
      await new Promise((accept) => setTimeout(accept, 1000))
   }
   throw new Error(
      `Timed out waiting for ${description}. Run container logs ${name(description.toLowerCase())}.`,
   )
}

async function start(
   service,
   { env = {}, args = [], ports = [], mounts = [], memory = '256M', entrypoint } = {},
) {
   const existing = await inspect(service)
   if (existing) {
      if (service === 'db') {
         if (existing.status.state !== 'running') await run(['start', name(service)])
         console.log(`Using ${name(service)}`)
         return
      }
      // Refresh dependency IPs after a VM restart; database volumes remain intact.
      if (existing.status.state === 'running') await run(['stop', name(service)])
      await run(['delete', name(service)])
   }
   const path = resolve(state, `${service}.env`)
   await privateFile(
      path,
      `${Object.entries(env)
         .map(([key, value]) => `${key}=${value}`)
         .join('\n')}\n`,
   )
   const options = [
      'run',
      '--detach',
      '--name',
      name(service),
      '--network',
      network,
      '--cpus',
      '1',
      '--memory',
      memory,
      '--env-file',
      path,
   ]
   for (const port of ports) options.push('--publish', `127.0.0.1:${port}`)
   for (const mount of mounts) options.push('--volume', mount)
   if (entrypoint) options.push('--entrypoint', entrypoint)
   console.log(`Starting ${name(service)} (${images[service]})`)
   await run([...options, images[service], ...args])
}

async function up() {
   // Reject invalid credentials before restarting any running services.
   const githubOAuth = await localGithubOAuth(resolve(state, 'github-oauth.env'))
   await run(['system', 'start'])
   const settings = await config()
   // Downloads only; the pinned official SQL is not executed on the host.
   for (const file of ['roles.sql', 'webhooks.sql']) {
      const path = resolve(state, file)
      let needsDownload = false
      try {
         await readFile(path)
      } catch (error) {
         if (error.code !== 'ENOENT') throw error
         needsDownload = true
      }
      if (needsDownload) {
         const response = await fetch(
            `https://raw.githubusercontent.com/supabase/supabase/${upstream}/docker/volumes/db/${file}`,
            { signal: AbortSignal.timeout(30_000) },
         )
         if (!response.ok) throw new Error(`Downloading ${file} failed: ${response.status}`)
         await writeFile(path, await response.text())
      }
      // These upstream scripts contain no credentials; guest postgres must read them.
      await chmod(path, 0o644)
   }
   const networks = await run(['network', 'list'])
   if (!networks.stdout.split('\n').some((line) => line.split(/\s+/)[0] === network))
      await run(['network', 'create', network])
   const volumes = await run(['volume', 'list'])
   for (const volume of ['editor-supabase-data', 'editor-supabase-db-config']) {
      if (!volumes.stdout.split('\n').some((line) => line.trim().split(/\s+/)[0] === volume))
         await run(['volume', 'create', volume])
   }
   // Apple named volumes do not promise Docker's automatic image-directory copy-up.
   // A named block volume cannot be attached to two running VMs simultaneously.
   if (!(await inspect('db'))) {
      await run([
         'run',
         '--rm',
         '--user',
         '0',
         '--memory',
         '256M',
         '--volume',
         'editor-supabase-db-config:/config',
         '--entrypoint',
         '/bin/sh',
         images.db,
         '-ec',
         'if [ ! -f /config/supautils.conf ]; then cp -a /etc/postgresql-custom/. /config/; fi',
      ])
   }
   await start('db', {
      memory: '1G',
      ports: ['54322:5432'],
      env: {
         POSTGRES_PASSWORD: settings.password,
         PGPASSWORD: settings.password,
         POSTGRES_DB: 'postgres',
         PGDATABASE: 'postgres',
         PGDATA: '/var/lib/postgresql/data/database',
         POSTGRES_HOST: '/var/run/postgresql',
         PGPORT: '5432',
         POSTGRES_PORT: '5432',
         JWT_EXP: '3600',
      },
      mounts: [
         'editor-supabase-data:/var/lib/postgresql/data',
         'editor-supabase-db-config:/etc/postgresql-custom',
         `${resolve(state, 'roles.sql')}:/docker-entrypoint-initdb.d/init-scripts/99-roles.sql:ro`,
         `${resolve(state, 'webhooks.sql')}:/docker-entrypoint-initdb.d/init-scripts/98-webhooks.sql:ro`,
      ],
      args: [
         'postgres',
         '-c',
         'config_file=/etc/postgresql/postgresql.conf',
         '-c',
         'data_directory=/var/lib/postgresql/data/database',
         '-c',
         'log_min_messages=warning',
      ],
   })
   await waitFor(
      'db',
      async () =>
         (
            await run(['exec', name('db'), 'pg_isready', '-U', 'postgres', '-h', '127.0.0.1'], {
               allowFailure: true,
            })
         ).code === 0,
   )
   // pg_isready can briefly succeed on the image's temporary initialization server.
   await waitFor(
      'db',
      async () =>
         (
            await run(
               [
                  'exec',
                  name('db'),
                  'psql',
                  '-h',
                  '127.0.0.1',
                  '-U',
                  'supabase_auth_admin',
                  '-d',
                  'postgres',
                  '-tAc',
                  'select 1',
               ],
               { allowFailure: true },
            )
         ).stdout.trim() === '1',
   )
   const db = await ip('db')
   const database = (user) => `postgres://${user}:${settings.password}@${db}:5432/postgres`
   await start('mail', { ports: ['54324:8025'] })
   await start('auth', {
      env: {
         GOTRUE_API_HOST: '0.0.0.0',
         GOTRUE_API_PORT: '9999',
         API_EXTERNAL_URL: 'http://127.0.0.1:54321',
         GOTRUE_SITE_URL: 'http://localhost:3000',
         GOTRUE_URI_ALLOW_LIST:
            'http://localhost:3000/auth/callback,http://127.0.0.1:3000/auth/callback,http://127.0.0.1:3101/auth/callback',
         GOTRUE_DB_DRIVER: 'postgres',
         GOTRUE_DB_DATABASE_URL: database('supabase_auth_admin'),
         GOTRUE_JWT_SECRET: settings.jwtSecret,
         GOTRUE_JWT_EXP: '3600',
         GOTRUE_JWT_AUD: 'authenticated',
         GOTRUE_JWT_ADMIN_ROLES: 'service_role',
         GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated',
         GOTRUE_DISABLE_SIGNUP: 'false',
         GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
         GOTRUE_MAILER_AUTOCONFIRM: 'true',
         GOTRUE_EXTERNAL_PHONE_ENABLED: 'false',
         GOTRUE_SMTP_HOST: await ip('mail'),
         GOTRUE_SMTP_PORT: '1025',
         GOTRUE_SMTP_ADMIN_EMAIL: 'admin@localhost.test',
         GOTRUE_SMTP_SENDER_NAME: 'Local Supabase',
         ...githubOAuth,
      },
   })
   await start('rest', {
      env: {
         PGRST_DB_URI: database('authenticator'),
         PGRST_DB_SCHEMAS: 'public,graphql_public',
         PGRST_DB_ANON_ROLE: 'anon',
         PGRST_JWT_SECRET: settings.jwtSecret,
         PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
         PGRST_ADMIN_SERVER_PORT: '3001',
      },
   })
   const gatewayPath = resolve(state, 'kong.yml')
   const auth = await ip('auth')
   const rest = await ip('rest')
   const protectedPlugins = [
      { name: 'cors' },
      { name: 'key-auth', config: { hide_credentials: false } },
      {
         name: 'request-transformer',
         config: { add: { headers: ['Authorization:Bearer $(headers.apikey)'] } },
      },
   ]
   const gatewayConfig = {
      _format_version: '2.1',
      _transform: true,
      consumers: [
         { username: 'anon', keyauth_credentials: [{ key: settings.anonKey }] },
         { username: 'service_role', keyauth_credentials: [{ key: settings.serviceKey }] },
      ],
      services: [
         ...['verify', 'callback', 'authorize', 'health', '.well-known/jwks.json'].map((path) => ({
            name: `auth-open-${path.replaceAll(/[^a-z]/g, '-')}`,
            url: `http://${auth}:9999/${path}`,
            routes: [{ paths: [`/auth/v1/${path}`], strip_path: true }],
            plugins: [{ name: 'cors' }],
         })),
         {
            name: 'auth',
            url: `http://${auth}:9999/`,
            routes: [{ paths: ['/auth/v1/'], strip_path: true }],
            plugins: protectedPlugins,
         },
         {
            name: 'rest',
            url: `http://${rest}:3000/`,
            routes: [{ paths: ['/rest/v1/'], strip_path: true }],
            plugins: protectedPlugins,
         },
      ],
   }
   await privateFile(gatewayPath, JSON.stringify(gatewayConfig, null, 2))
   await start('gateway', {
      ports: ['54321:8000'],
      env: {
         KONG_DATABASE: 'off',
         KONG_DECLARATIVE_CONFIG_STRING: JSON.stringify(gatewayConfig),
         KONG_DNS_ORDER: 'LAST,A,CNAME',
         KONG_PLUGINS: 'cors,key-auth,request-transformer',
         KONG_NGINX_WORKER_PROCESSES: '1',
         KONG_PROXY_LISTEN: '0.0.0.0:8000',
         KONG_ADMIN_LISTEN: 'off',
      },
   })
   await start('meta', {
      env: {
         PG_META_PORT: '8080',
         PG_META_DB_HOST: db,
         PG_META_DB_PORT: '5432',
         PG_META_DB_NAME: 'postgres',
         PG_META_DB_USER: 'postgres',
         PG_META_DB_PASSWORD: settings.password,
         CRYPTO_KEY: settings.metaKey,
      },
   })
   await start('studio', {
      memory: '1G',
      ports: ['54323:3000'],
      env: {
         HOSTNAME: '0.0.0.0',
         STUDIO_PG_META_URL: `http://${await ip('meta')}:8080`,
         PG_META_CRYPTO_KEY: settings.metaKey,
         POSTGRES_HOST: db,
         POSTGRES_PORT: '5432',
         POSTGRES_DB: 'postgres',
         POSTGRES_PASSWORD: settings.password,
         POSTGRES_USER_READ_WRITE: 'postgres',
         SUPABASE_URL: `http://${await ip('gateway')}:8000`,
         SUPABASE_PUBLIC_URL: 'http://127.0.0.1:54321',
         SUPABASE_ANON_KEY: settings.anonKey,
         SUPABASE_SERVICE_KEY: settings.serviceKey,
         AUTH_JWT_SECRET: settings.jwtSecret,
         DEFAULT_ORGANIZATION_NAME: 'Local',
         DEFAULT_PROJECT_NAME: 'Editor',
         PGRST_DB_SCHEMAS: 'public,graphql_public',
         NEXT_PUBLIC_ENABLE_LOGS: 'false',
         ENABLED_FEATURES_LOGS_ALL: 'false',
      },
   })
   await privateFile(
      resolve(state, 'app.env'),
      `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${settings.anonKey}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${settings.anonKey}\nSUPABASE_SERVICE_ROLE_KEY=${settings.serviceKey}\nDATABASE_URL=${database('postgres').replace(db, '127.0.0.1').replace(':5432/', ':54322/')}\n`,
   )
   await status()
}

async function status() {
   for (const service of names) {
      const value = await inspect(service)
      console.log(`${name(service)}: ${value?.status?.state ?? 'not created'}`)
   }
   const settings = JSON.parse(await readFile(resolve(state, 'credentials.json'), 'utf8'))
   for (const [label, url, headers] of [
      ['Auth', 'http://127.0.0.1:54321/auth/v1/health', {}],
      ['REST', 'http://127.0.0.1:54321/rest/v1/', { apikey: settings.anonKey }],
      ['Studio', 'http://127.0.0.1:54323/api/platform/profile', {}],
      ['Mail', 'http://127.0.0.1:54324/livez', {}],
   ]) {
      await waitFor(
         label,
         async () => (await fetch(url, { headers, signal: AbortSignal.timeout(3000) })).ok,
      )
      console.log(`${label}: healthy`)
   }
   console.log(
      `API: http://127.0.0.1:54321\nStudio: http://127.0.0.1:54323\nMail: http://127.0.0.1:54324\nApplication environment: ${resolve(state, 'app.env')}`,
   )
}

try {
   const action = process.argv[2] ?? 'status'
   if (action === 'up') await up()
   else if (action === 'status') await status()
   else if (action === 'stop') {
      for (const service of [...names].reverse()) {
         if ((await inspect(service))?.status?.state === 'running')
            await run(['stop', name(service)])
      }
      console.log(
         'Stopped local Supabase; containers, credentials and database volumes are preserved.',
      )
   } else throw new Error('Usage: node scripts/local-supabase.mjs up|status|stop')
} catch (error) {
   console.error(error.message)
   process.exitCode = 1
}
