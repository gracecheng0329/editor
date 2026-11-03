import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localGithubOAuth } from './local-github-oauth.mjs';

test('GitHub provider is opt-in and credentials stay in private local configuration', async t => {
  const dir = await mkdtemp(join(tmpdir(), 's1-oauth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'github.env');
  assert.equal((await localGithubOAuth(path)).GOTRUE_EXTERNAL_GITHUB_ENABLED, 'false');
  await writeFile(path, "GITHUB_CLIENT_ID='local-client'\nGITHUB_CLIENT_SECRET='local-secret'\n", { mode: 0o600 });
  const config = await localGithubOAuth(path);
  assert.equal(config.GOTRUE_EXTERNAL_GITHUB_ENABLED, 'true');
  assert.equal(config.GOTRUE_EXTERNAL_GITHUB_CLIENT_ID, 'local-client');
  assert.equal(config.GOTRUE_EXTERNAL_GITHUB_SECRET, 'local-secret');
  assert.equal(config.GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI, 'http://127.0.0.1:54321/auth/v1/callback');
  await chmod(path, 0o644);
  await assert.rejects(localGithubOAuth(path), /mode 0600/);
});

test('partial or newline-injected OAuth credentials fail without revealing secrets', async t => {
  const dir = await mkdtemp(join(tmpdir(), 's1-oauth-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'github.env');
  for (const body of ["GITHUB_CLIENT_ID=client\n", 'GITHUB_CLIENT_ID=client\nGITHUB_CLIENT_SECRET="private\nINJECT=true"\n']) {
    await writeFile(path, body, { mode: 0o600 });
    await assert.rejects(localGithubOAuth(path), error => {
      assert.doesNotMatch(error.message, /private|INJECT/);
      return /requires a valid client ID and secret/.test(error.message);
    });
  }
});
