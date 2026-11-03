import { test, expect } from '@playwright/test';

test('an unauthenticated user cannot create a private document', async ({ request }) => {
  const response = await request.post('/api/documents', { data: { title: 'Private' } });
  expect(response.status()).toBe(401);
  expect(await response.json()).toEqual({ error: 'UNAUTHENTICATED' });
});

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const credentials = JSON.parse(readFileSync(process.env.S1_CREDENTIALS_FILE ?? '.local-supabase/credentials.json', 'utf8'));
const url = 'http://127.0.0.1:54321';

test('an owner can create and retrieve a private document', async ({ request }) => {
  const admin = createClient(url, credentials.serviceKey, { auth: { persistSession: false } });
  const email = `${randomUUID()}@example.test`;
  const password = randomUUID();
  const { data: created, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  expect(error).toBeNull();
  const cookies = new Map<string, string>();
  const client = createServerClient(url, credentials.anonKey, { cookies: {
    getAll: () => [...cookies].map(([name, value]) => ({ name, value })),
    setAll: (values) => values.forEach(({ name, value }) => cookies.set(name, value)),
  } });
  try {
    expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    const headers = { cookie: [...cookies].map(([name, value]) => `${name}=${value}`).join('; ') };
    const response = await request.post('/api/documents', { data: { title: '  Architecture  ', owner_id: randomUUID(), room_id: randomUUID(), shared: true }, headers });
    expect(response.status()).toBe(201);
    const doc = await response.json();
    expect(doc.title).toBe('Architecture');
    expect(doc.owner_id).toBe(created.user!.id);
    expect(doc).not.toHaveProperty('shared');
    const read = await request.get(`/api/documents/${doc.id}`, { headers });
    expect(read.status()).toBe(200);
    expect((await read.json()).title).toBe('Architecture');
    expect((await client.from('documents').update({ room_id: randomUUID() }).eq('id', doc.id)).error).not.toBeNull();
    expect((await client.from('documents').insert({ title: 'Forged', owner_id: created.user!.id, room_id: randomUUID() })).error).not.toBeNull();
    for (const data of [null, [], { title: 42 }]) {
      expect((await request.post('/api/documents', { data, headers })).status()).toBe(422);
    }
    expect((await request.post('/api/documents', { data: '{', headers: { ...headers, 'content-type': 'application/json' } })).status()).toBe(422);
    const list = await request.get('/api/documents', { headers });
    expect(list.status()).toBe(200);
    expect((await list.json()).map((item: { id: string }) => item.id)).toContain(doc.id);
    const rename = await request.patch(`/api/documents/${doc.id}`, { data: { title: 'Revised' }, headers });
    expect(rename.status()).toBe(200);
    expect((await rename.json()).title).toBe('Revised');
    expect((await (await request.get(`/api/documents/${doc.id}`, { headers })).json()).title).toBe('Revised');
    expect((await request.post('/api/documents', { data: { title: '   ' }, headers })).status()).toBe(422);
    expect((await request.patch(`/api/documents/${doc.id}`, { data: { title: '   ' }, headers })).status()).toBe(422);
    expect((await request.post('/api/documents', { data: { title: 'CSRF' }, headers: { ...headers, origin: 'https://evil.example' } })).status()).toBe(403);
    const otherEmail = `${randomUUID()}@example.test`;
    const otherPassword = randomUUID();
    const otherUser = await admin.auth.admin.createUser({ email: otherEmail, password: otherPassword, email_confirm: true });
    expect(otherUser.error).toBeNull();
    const otherCookies = new Map<string, string>();
    const other = createServerClient(url, credentials.anonKey, { cookies: {
      getAll: () => [...otherCookies].map(([name, value]) => ({ name, value })),
      setAll: (values) => values.forEach(({ name, value }) => otherCookies.set(name, value)),
    } });
    try {
      expect((await other.auth.signInWithPassword({ email: otherEmail, password: otherPassword })).error).toBeNull();
      const otherHeaders = { cookie: [...otherCookies].map(([name, value]) => `${name}=${value}`).join('; ') };
      expect((await (await request.get('/api/documents', { headers: otherHeaders })).json()).map((item: { id: string }) => item.id)).not.toContain(doc.id);
      expect((await request.get(`/api/documents/${doc.id}`, { headers: otherHeaders })).status()).toBe(404);
      expect((await request.patch(`/api/documents/${doc.id}`, { data: { title: 'Stolen' }, headers: otherHeaders })).status()).toBe(404);
      expect((await other.from('documents').select().eq('id', doc.id)).data).toEqual([]);
      expect((await other.from('documents').update({ title: 'Stolen' }).eq('id', doc.id).select()).data).toEqual([]);
      expect((await other.from('documents').insert({ title: 'Impersonated', owner_id: created.user!.id })).error).not.toBeNull();
    } finally {
      if (otherUser.data.user) await admin.auth.admin.deleteUser(otherUser.data.user.id);
    }
  } finally {
    if (created.user) { await admin.from('documents').delete().eq('owner_id', created.user.id); await admin.auth.admin.deleteUser(created.user.id); }
  }
});
