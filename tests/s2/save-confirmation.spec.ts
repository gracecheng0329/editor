import { test, expect, type Route } from '@playwright/test';
import { registeredUser } from '../s1/sharing-fixtures';

test('automatic confirmation never treats old responses or failed requests as saved and retries without losing nodes', async ({ browser }) => {
  const owner = await registeredUser(false);
  const context = await browser.newContext();
  try {
    await context.addCookies(owner.browserCookies().map(cookie => ({ ...cookie, url: 'http://127.0.0.1:3102' })));
    const creation = await context.request.post('/api/documents', { headers: { Origin: 'http://127.0.0.1:3102' }, data: { title: 'Reliable confirmation' } });
    expect(creation.status()).toBe(201);
    const document = await creation.json();
    const page = await context.newPage();
    await page.goto(`/documents/${document.id}`);
    await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化');
    // Hold a genuine old authoritative response; the sync service still processes
    // actual node edits. No SDK state or WebSocket payload is mocked.
    let release: (() => Promise<void>) | undefined;
    let hold = true;
    const routeCheckpoint = async (route: Route) => {
      if (!hold) { await route.fulfill({ status: 503, body: 'Service unavailable' }); return; }
      hold = false;
      const response = await route.fetch();
      release = () => route.fulfill({ response });
    };
    await page.route('**/checkpoint', routeCheckpoint);
    await page.getByLabel('新增節點名稱').fill('First revision');
    await page.getByRole('button', { name: '新增節點', exact: true }).click();
    await expect.poll(() => Boolean(release)).toBe(true);
    await page.getByLabel('新增節點名稱').fill('Later revision');
    await page.getByRole('button', { name: '新增節點', exact: true }).click();
    await release!();
    await expect(page.getByLabel('保存狀態')).not.toHaveText('已確認持久化');
    await expect(page.getByLabel('保存狀態')).toHaveText('保存失敗／待同步');
    await expect(page.getByLabel('畫布節點')).toContainText('Later revision');
    await page.unroute('**/checkpoint', routeCheckpoint);
    await page.getByRole('button', { name: '重試保存', exact: true }).click();
    await expect(page.getByLabel('保存狀態')).toHaveText('已確認持久化');
    await page.reload();
    await expect(page.getByLabel('畫布節點')).toContainText('First revision');
    await expect(page.getByLabel('畫布節點')).toContainText('Later revision');
  } finally { await context.close(); await owner.cleanup(); }
});
