import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './with-api-key.js';
import { UserStore, type User } from '../src/users-store.js';

const externalWallets = [
  '11111111111111111111111111111111', // 32 zero bytes
  '11111111111111111111111111111112', // 31 leading zero bytes
  'So11111111111111111111111111111111111111112',
];

for (const wallet of externalWallets) {
  test(`overview represents a wallet absent from the local snapshot: ${wallet}`, async () => {
    const app = buildApp([], { userStore: new UserStore([]) });
    try {
      const response = await app.inject(`/v1/users/${wallet}/overview`);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        address: wallet,
        profile: null,
        isPumpUser: false,
        counts: { followers: null, following: null },
        verified: false,
        achievementBadgeIds: [],
        banned: null,
        createdCoinsCount: null,
        degraded: ['counts', 'banned', 'created_coins'],
      });
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.equal(response.headers['x-reconstruction-data-source'], 'synthetic-seed-play');
      // The separate single-profile read still requires a local profile row.
      assert.equal((await app.inject(`/v1/users/${wallet}`)).statusCode, 404);
    } finally {
      await app.close();
    }
  });
}

test('overview keeps missing user IDs and malformed or wrong-width wallets at 404', async () => {
  const app = buildApp([], { userStore: new UserStore([]) });
  try {
    for (const id of [
      '0c2579f1-c27a-4195-9f35-e507e884fc21', 'NONEXISTENT',
      '1'.repeat(31), '1'.repeat(33), 'z'.repeat(44), // 31 or 33 decoded bytes
      '0'.repeat(32), 'O'.repeat(32), 'I'.repeat(32), 'l'.repeat(32),
    ]) {
      const response = await app.inject(`/v1/users/${id}/overview`);
      assert.equal(response.statusCode, 404, id);
      assert.deepEqual(response.json(), { statusCode: 404, error: 'NOT_FOUND' });
      assert.equal(response.headers['x-reconstruction-data-source'], undefined);
    }
  } finally {
    await app.close();
  }
});

test('a present local profile takes precedence over external-wallet classification', async () => {
  const wallet = externalWallets[1];
  const user: User = {
    address: wallet, userId: 'local-user', username: 'local', profile_image: null,
    bio: null, followers: 3, following: 2, x_username: null,
    is_pump_user: false, is_banned: true, last_active_at: '2026-01-01T00:00:00Z',
  };
  const store = new UserStore([user], [wallet]);
  const app = buildApp([], { userStore: store });
  try {
    const { last_active_at: _activity, ...profile } = user;
    for (const id of [wallet, 'local-user']) {
      const response = await app.inject(`/v1/users/${id}/overview`);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(response.json(), {
        address: id, profile, isPumpUser: true,
        counts: { followers: 3, following: 2 }, verified: true,
        achievementBadgeIds: [], banned: true, createdCoinsCount: 0, degraded: [],
      });
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    assert.deepEqual(store.getById(wallet), user);
  } finally {
    await app.close();
  }
});
