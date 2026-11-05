import { test, expect } from '@playwright/test';
import { registeredUser } from '../s1/sharing-fixtures';

const origin = 'http://127.0.0.1:3102';
const service = 'http://127.0.0.1:8789';
test('Worker rejects strangers, share viewers and cross-document or forged room tickets', async ({ request, browser }) => {
  const owner = await registeredUser(false);
  const stranger = await registeredUser(false);
  const context = await browser.newContext();
  try {
    await context.addCookies(owner.browserCookies().map(cookie => ({ ...cookie, url: origin })));
    const creation = await request.post(`${origin}/api/documents`, { headers: { ...owner.headers, Origin: origin }, data: { title: 'Restricted canvas' } });
    expect(creation.status()).toBe(201);
    const document = await creation.json();
    const session = (await owner.client.auth.getSession()).data.session!;
    const strangerSession = (await stranger.client.auth.getSession()).data.session!;
    const headers = { Origin: origin, Authorization: `Bearer ${session.access_token}` };
    const issued = await request.post(`${service}/documents/${document.id}/session`, { headers });
    expect(issued.status()).toBe(200);
    expect(issued.headers()['cache-control']).toContain('no-store');
    const { ticket } = await issued.json();
    expect(ticket).not.toContain(session.access_token);
    const checkpoint = await request.post(`${service}/documents/${document.id}/checkpoint`, { headers });
    expect(checkpoint.status()).toBe(200);
    const before = await checkpoint.json();
    expect((await request.post(`${service}/documents/${document.id}/checkpoint`, { headers: { Origin: origin } })).status()).toBe(401);
    expect((await request.post(`${service}/documents/${document.id}/session`, { headers: { Origin: origin, Authorization: `Bearer ${strangerSession.access_token}` } })).status()).toBe(404);
    expect((await request.post(`${service}/documents/${document.id}/checkpoint`, { headers: { Origin: origin, Authorization: `Bearer ${strangerSession.access_token}` } })).status()).toBe(404);
    const share = await owner.client.rpc('set_document_share', { target_id: document.id, enable: true });
    expect(share.error).toBeNull();
    expect((await request.post(`${service}/documents/${document.id}/checkpoint?shareToken=${share.data.token}`, { headers: { Origin: origin } })).status()).toBe(401);
    const upgrade = { Origin: origin, Upgrade: 'websocket', Connection: 'Upgrade', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==' };
    const other = await stranger.client.from('documents').insert({ title: 'Other room', owner_id: stranger.id }).select().single();
    expect(other.error).toBeNull();
    expect((await request.get(`${service}/documents/${other.data!.id}?ticket=${encodeURIComponent(ticket)}&sessionId=wrong-document`, { headers: upgrade })).status()).toBe(401);
    expect((await request.get(`${service}/documents/${document.id}?ticket=${encodeURIComponent(`${ticket}tampered`)}&sessionId=forged`, { headers: upgrade })).status()).toBe(401);
    expect((await request.get(`${service}/documents/${document.id}?accessToken=${session.access_token}&sessionId=broad-token`, { headers: upgrade })).status()).toBe(401);
    expect((await request.post(`${service}/documents/${document.id}/checkpoint`, { headers: { ...headers, Origin: 'https://untrusted.example' } })).status()).toBe(403);
    const after = await request.post(`${service}/documents/${document.id}/checkpoint`, { headers });
    expect((await after.json()).snapshot.store).toEqual(before.snapshot.store);
    const viewerPage = await request.get(`${origin}/api/documents/${document.id}/sync-session`, { headers: stranger.headers });
    expect(viewerPage.status()).toBe(404);
    const reopened = await context.newPage();
    await reopened.goto(`/documents/${document.id}`);
    await expect(reopened.getByLabel('保存狀態')).toHaveText('已確認持久化');
    await expect(reopened.getByLabel('畫布節點').getByRole('listitem')).toHaveCount(0);
  } finally { await context.close(); await owner.cleanup(); await stranger.cleanup(); }
});
