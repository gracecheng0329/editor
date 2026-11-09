import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createServerClient } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'

const credentials = JSON.parse(
   readFileSync(process.env.S1_CREDENTIALS_FILE ?? '.local-supabase/credentials.json', 'utf8'),
)
const url = 'http://127.0.0.1:54321'
export const anonymous = () =>
   createClient(url, credentials.anonKey, { auth: { persistSession: false } })
export const admin = createClient(url, credentials.serviceKey, { auth: { persistSession: false } })

// Trusted provider fixtures exist only in the local test database. Password
// sessions are real Auth sessions; this does not simulate the OAuth smoke test.
export async function registeredUser(github = true, displayName = `GitHub ${randomUUID()}`) {
   const email = `${randomUUID()}@example.test`
   const password = randomUUID()
   const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: displayName },
   })
   if (created.error || !created.data.user) throw new Error('Could not create test identity')
   const id = created.data.user.id
   try {
      if (github) {
         const result = spawnSync(
            'container',
            [
               'exec',
               '--interactive',
               'editor-supabase-db',
               'psql',
               '-U',
               'postgres',
               '-d',
               'postgres',
               '-v',
               'ON_ERROR_STOP=1',
            ],
            {
               input: `insert into auth.identities (provider_id,user_id,identity_data,provider,created_at,updated_at) values ('${id}','${id}','{"sub":"${id}"}','github',now(),now());`,
               encoding: 'utf8',
            },
         )
         if (result.status !== 0)
            throw new Error('Could not seed local trusted GitHub identity fixture')
      }
      const cookies = new Map<string, string>()
      const client = createServerClient(url, credentials.anonKey, {
         cookies: {
            getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
            setAll: (values) =>
               values.forEach(({ name, value }) => {
                  cookies.set(name, value)
               }),
         },
      })
      const signin = await client.auth.signInWithPassword({ email, password })
      if (signin.error) throw new Error(`Could not sign in test identity: ${signin.error.message}`)
      return {
         id,
         displayName,
         client,
         headers: { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') },
         browserCookies: () =>
            [...cookies].map(([name, value]) => ({ name, value, url: 'http://127.0.0.1:3101' })),
         async cleanup() {
            await admin.from('documents').delete().eq('owner_id', id)
            await admin.auth.admin.deleteUser(id)
         },
      }
   } catch (error) {
      await admin.auth.admin.deleteUser(id)
      throw error
   }
}
