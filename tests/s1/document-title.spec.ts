import { test, expect } from '@playwright/test';
import { registeredUser } from './sharing-fixtures';

test('direct Data API rejects blank titles using the same whitespace set as document API input', async () => {
  const owner = await registeredUser();
  try {
    const created = await owner.client.from('documents').insert({ owner_id: owner.id, title: 'Keep this architecture' }).select().single();
    expect(created.error).toBeNull();
    const whitespace = ['\t', '\n\r', '\v\f', ' \t\n ', '\u00a0', '\u1680', '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a', '\u2028\u2029', '\u202f\u205f\u3000', '\ufeff'];
    for (const title of whitespace) {
      const insert = await owner.client.from('documents').insert({ owner_id: owner.id, title });
      expect(insert.error?.code, `blank insert ${JSON.stringify(title)}`).toBe('23514');
      const update = await owner.client.from('documents').update({ title }).eq('id', created.data!.id);
      expect(update.error?.code, `blank update ${JSON.stringify(title)}`).toBe('23514');
    }
    const reopened = await owner.client.from('documents').select('title').eq('id', created.data!.id).single();
    expect(reopened.data?.title).toBe('Keep this architecture');
    // Zero-width space is intentionally not ECMAScript trim whitespace.
    expect((await owner.client.from('documents').insert({ owner_id: owner.id, title: '\u200b' })).error).toBeNull();
  } finally { await owner.cleanup(); }
});
