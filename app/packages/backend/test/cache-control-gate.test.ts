import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { TEST_API_KEY } from './with-api-key.js';

test('accepted API-key responses are non-cacheable over HTTP', async () => {
  const app = buildApp();
  const origin = await app.listen({ host: '127.0.0.1', port: 0 });
  const headers = { authorization: `Bearer ${TEST_API_KEY}` };
  try {
    const success = await fetch(`${origin}/v1/users`, { headers });
    assert.equal(success.status, 200);
    assert.equal(success.headers.get('cache-control'), 'no-store');

    const notFound = await fetch(`${origin}/v1/users/not-a-user`, { headers });
    assert.equal(notFound.status, 404);
    assert.equal(notFound.headers.get('cache-control'), 'no-store');

    const unauthorized = await fetch(`${origin}/v1/users`, {
      headers: { authorization: 'Bearer pf_live_short' },
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('cache-control'), null);
  } finally {
    await app.close();
  }
});
