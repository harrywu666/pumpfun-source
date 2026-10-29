import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApp } from './with-api-key.js';
import { FollowingStore } from '../src/following-store.js';
import { UserStore, type User } from '../src/users-store.js';

const user = (address: string, userId: string, username: string): User => ({
  address,
  userId,
  username,
  profile_image: null,
  bio: null,
  followers: 0,
  following: 0,
  x_username: null,
});

const users = [
  user('wallet-alice', 'user-alice', 'Alice'),
  user('wallet-bob', 'user-bob', 'Bob'),
  user('wallet-carol', 'user-carol', 'Carol'),
];

const edges = [
  { follower_id: 'user-bob', following_id: 'user-alice', timestamp: 100 },
  { follower_id: 'user-carol', following_id: 'user-alice', timestamp: 200 },
  { follower_id: 'user-alice', following_id: 'user-bob', timestamp: 300 },
];

function makeApp() {
  const userStore = new UserStore(users);
  return buildApp([], {
    userStore,
    followingStore: new FollowingStore(userStore, edges),
  });
}

test('follow pages and counts resolve a wallet alias the same as userId', async () => {
  const app = makeApp();
  try {
    for (const path of [
      '/v1/following/v3/followers',
      '/v1/following/v3/following',
      '/v1/following/v3/followers/count',
      '/v1/following/v3/following/count',
    ]) {
      const byUserId = await app.inject(`${path}/user-alice`);
      const byWallet = await app.inject(`${path}/wallet-alice`);
      assert.equal(byUserId.statusCode, 200, path);
      assert.equal(byWallet.statusCode, 200, path);
      assert.deepEqual(byWallet.json(), byUserId.json(), path);
    }
  } finally {
    await app.close();
  }
});

test('follow search and relationship reads resolve endpoint aliases', async () => {
  const app = makeApp();
  try {
    for (const side of ['followers', 'following']) {
      const path = `/v1/following/v3/${side}/search`;
      const byUserId = await app.inject(`${path}/user-alice?searchTerm=Bob`);
      const byWallet = await app.inject(`${path}/wallet-alice?searchTerm=Bob`);
      assert.equal(byUserId.statusCode, 200, path);
      assert.equal(byWallet.statusCode, 200, path);
      assert.deepEqual(byWallet.json(), byUserId.json(), path);
    }

    const relationship = await app.inject(
      '/v1/following/single/user-bob?userId=wallet-alice',
    );
    assert.equal(relationship.statusCode, 200);
    assert.deepEqual(relationship.json(), {
      follow: {
        following_id: 'user-bob',
        user_id: 'user-alice',
        timestamp: 300,
      },
    });
  } finally {
    await app.close();
  }
});
