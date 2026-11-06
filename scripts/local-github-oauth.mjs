import { readFile, stat } from 'node:fs/promises'
import { parseEnv } from 'node:util'

// An optional, private dotenv file; never source it as executable shell code.
export async function localGithubOAuth(path) {
   let settings
   try {
      const info = await stat(path)
      if (info.mode & 0o077) throw new Error('GitHub OAuth settings must have mode 0600.')
      settings = parseEnv(await readFile(path, 'utf8'))
   } catch (error) {
      if (error.code === 'ENOENT') return { GOTRUE_EXTERNAL_GITHUB_ENABLED: 'false' }
      throw error
   }
   const id = settings.GITHUB_CLIENT_ID
   const secret = settings.GITHUB_CLIENT_SECRET
   if (
      ![id, secret].every((value) => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value))
   ) {
      throw new Error('GitHub OAuth requires a valid client ID and secret; values are not logged.')
   }
   return {
      GOTRUE_EXTERNAL_GITHUB_ENABLED: 'true',
      GOTRUE_EXTERNAL_GITHUB_CLIENT_ID: id,
      GOTRUE_EXTERNAL_GITHUB_SECRET: secret,
      GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI: 'http://127.0.0.1:54321/auth/v1/callback',
   }
}
