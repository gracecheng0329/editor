import { spawn } from 'node:child_process'

process.loadEnvFile('.s2-remote/local-frontend.env')
if (
   process.env.S2_LOCAL_FRONTEND !== '1' ||
   process.env.S2_APP_ORIGIN !== 'http://127.0.0.1:3103'
) {
   throw new Error('Local acceptance configuration must use http://127.0.0.1:3103')
}
// Keep --env-file out of Next's execArgv: Next forwards those flags to NODE_OPTIONS.
const child = spawn(
   process.execPath,
   [
      'node_modules/next/dist/bin/next',
      'dev',
      '--webpack',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3103',
   ],
   { env: process.env, stdio: 'inherit' },
)
child.on('error', () => {
   console.error('Could not start the local acceptance frontend')
   process.exitCode = 1
})
child.on('exit', (code) => {
   process.exitCode = code ?? 1
})
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
