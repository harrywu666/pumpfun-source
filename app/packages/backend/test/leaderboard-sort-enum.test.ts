import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildApp } from './with-api-key.js';

const spec = JSON.parse(
  readFileSync(
    new URL('../../../contracts/developer.openapi.json', import.meta.url),
    'utf8',
  ),
);
const allowed = spec.paths['/pnl-leaderboard'].get.parameters.find(
  (parameter: { name: string }) => parameter.name === 'sort',
).schema.enum;

test('pnl leaderboard rejects sort values outside the documented enum', async () => {
  const app = buildApp([]);
  try {
    for (const sort of ['marketCap', '', 'Combined']) {
      const response = await app.inject(
        `/v1/pnl-leaderboard?period=weekly&sort=${encodeURIComponent(sort)}`,
      );
      assert.equal(response.statusCode, 400, `sort=${JSON.stringify(sort)}`);
      assert.deepEqual(response.json(), {
        statusCode: 400,
        error: 'INVALID_SORT',
        allowed,
        received: sort,
      });
    }

    for (const sort of allowed) {
      const response = await app.inject(
        `/v1/pnl-leaderboard?period=weekly&sort=${sort}&limit=1`,
      );
      assert.equal(response.statusCode, 200, `sort=${sort}`);
    }
  } finally {
    await app.close();
  }
});
