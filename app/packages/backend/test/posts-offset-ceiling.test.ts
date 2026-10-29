import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PostStore, type RawPost } from '../src/posts-store.js';
import { UserStore, type User } from '../src/users-store.js';
import { buildApp } from './with-api-key.js';

const users = JSON.parse(
  readFileSync(new URL('../src/users-seed.json', import.meta.url), 'utf8'),
) as User[];
const posts = JSON.parse(
  readFileSync(new URL('../src/posts-seed.json', import.meta.url), 'utf8'),
) as RawPost[];

test('engagement pages fail closed at the documented offset ceiling', async () => {
  const offsetUsers = Array.from({ length: 10_250 }, (_, index) => {
    const id = `offset-user-${String(index).padStart(5, "0")}`;
    return {
      ...structuredClone(users[0]),
      address: id,
      userId: id,
      username: id,
      canonical_svm_wallet: id,
    };
  });
  const userStore = new UserStore(offsetUsers);
  const post = structuredClone(posts[0]);
  const ids = offsetUsers.map((user) => user.userId!);
  post.likers = ids;
  post.reposters = ids;
  const app = buildApp([], {
    userStore,
    postStore: new PostStore([post], userStore),
  });

  try {
    for (const relation of ['likers', 'reposters'] as const) {
      const reachable = await app.inject(
        `/v1/posts/${post.postId}/${relation}?offset=9800&limit=200`,
      );
      assert.equal(reachable.statusCode, 200);
      assert.equal(reachable.json().hasMore, true);

      const boundary = await app.inject(
        `/v1/posts/${post.postId}/${relation}?offset=10000&limit=200`,
      );
      assert.equal(boundary.statusCode, 200);
      assert.equal(boundary.json()[relation].length, 200);
      assert.equal(boundary.json().hasMore, false);

      const beyond = await app.inject(
        `/v1/posts/${post.postId}/${relation}?offset=10200&limit=200`,
      );
      assert.equal(beyond.statusCode, 400);
      assert.equal(beyond.json().error, 'INVALID_OFFSET');
    }
  } finally {
    await app.close();
  }
});
