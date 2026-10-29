import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildApp } from './with-api-key.js';

const contract = JSON.parse(
  readFileSync(new URL('../../../contracts/developer.openapi.json', import.meta.url), 'utf8'),
);

test('the competition list contract declares no query parameters', () => {
  assert.equal(contract.paths['/competitions'].get.parameters, undefined);
});

test('the competition list rejects undocumented query parameters instead of serving all buckets', async () => {
  const app = buildApp();
  try {
    for (const query of ['phase=live', 'limit=1', '%70hase=live']) {
      const response = await app.inject(`/v1/competitions?${query}`);
      assert.equal(response.statusCode, 501, query);
      assert.deepEqual(response.json(), {
        statusCode: 501,
        error: 'COMPATIBILITY_NOT_IMPLEMENTED',
        reason: 'COMPETITION_QUERY_UNSUPPORTED',
      }, query);
      assert.equal(response.headers['x-reconstruction-data-source'], undefined);
    }

    const unfiltered = await app.inject('/v1/competitions');
    assert.equal(unfiltered.statusCode, 200);
    assert.deepEqual(
      Object.keys(unfiltered.json()).sort(),
      ['live', 'past', 'upcoming'],
    );
  } finally {
    await app.close();
  }
});
