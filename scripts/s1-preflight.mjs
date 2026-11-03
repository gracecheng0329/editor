import { pathToFileURL } from 'node:url';

function origin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use an HTTPS origin, or an HTTP loopback origin, without a path or credentials.');
  }
  return url.origin;
}

export async function preflight(appValue, supabaseValue) {
  const app = origin(appValue);
  const supabase = origin(supabaseValue);
  const passed = [];
  async function check(label, path, verify) {
    const response = await fetch(app + path, { redirect: 'manual', signal: AbortSignal.timeout(15000) });
    let valid = false;
    try { valid = await verify(response); } catch { /* Keep malformed response details private. */ }
    if (!valid) throw new Error(`${label} failed; check the deployment and Auth configuration.`);
    passed.push(label);
    return response;
  }
  await check('Product homepage', '/', async r => r.status === 200 && (await r.text()).includes('使用 GitHub 登入'));
  await check('Anonymous document list denied', '/api/documents', async r => r.status === 401 && (await r.json()).error === 'UNAUTHENTICATED');
  await check('Cancelled OAuth is retryable', '/auth/callback?error=access_denied', r => {
    const location = new URL(r.headers.get('location') || '/', app);
    return [302, 303, 307].includes(r.status) && location.origin === app && location.pathname === '/' && location.searchParams.get('auth') === 'failed';
  });
  const login = await check('PKCE login targets expected Supabase and app callback', '/auth/login', r => {
    const target = new URL(r.headers.get('location') || '/', app);
    return [302, 303, 307].includes(r.status) && target.origin === supabase && target.pathname === '/auth/v1/authorize'
      && target.searchParams.get('provider') === 'github'
      && target.searchParams.get('redirect_to') === `${app}/auth/callback`
      && target.searchParams.get('code_challenge_method') === 's256'
      && /^[A-Za-z0-9_-]{43}$/.test(target.searchParams.get('code_challenge') || '');
  });
  // Stop at GitHub. No credentials, code exchange, browser session or product writes.
  const provider = await fetch(login.headers.get('location'), { redirect: 'manual', signal: AbortSignal.timeout(15000) });
  const target = new URL(provider.headers.get('location') || '/', supabase);
  if (![302, 303, 307].includes(provider.status) || target.origin !== 'https://github.com' || target.pathname !== '/login/oauth/authorize'
    || !target.searchParams.get('client_id') || target.searchParams.get('redirect_uri') !== `${supabase}/auth/v1/callback`) {
    throw new Error('GitHub provider redirect failed; enable GitHub and verify its Auth callback configuration.');
  }
  passed.push('GitHub provider redirects to the expected Auth callback');
  return passed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node scripts/s1-preflight.mjs APP_ORIGIN SUPABASE_ORIGIN');
    for (const label of await preflight(process.argv[2], process.argv[3])) console.log(`PASS ${label}`);
    console.log('Preflight only: real GitHub login, authenticated CRUD/sharing and logout smoke remain required.');
  } catch (error) {
    // Never print redirect URLs, OAuth state, response bodies or raw network errors.
    console.error(error instanceof TypeError || error.name === 'TimeoutError' ? 'Preflight request failed; verify reachable origins.' : error.message);
    process.exitCode = 1;
  }
}
