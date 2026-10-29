import assert from "node:assert/strict";
import { test } from "node:test";
import { HomeFeedStore, type HomeFeedFilters } from "../src/home-feed-store.js";

const filters: HomeFeedFilters = { chains: [], assetClasses: [] };
const unsafe = Number.MAX_SAFE_INTEGER + 1;

test("ranked direct reads reject unsafe or out-of-range pagination", () => {
  const store = new HomeFeedStore();

  for (const page of [
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    unsafe,
  ]) {
    assert.throws(
      () => store.ranked({ filters, page, pageSize: 2 }),
      RangeError,
      `page=${page}`,
    );
  }
  for (const pageSize of [
    0,
    201,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    unsafe,
  ]) {
    assert.throws(
      () => store.ranked({ filters, page: 0, pageSize }),
      RangeError,
      `pageSize=${pageSize}`,
    );
  }
});

test("ranked direct reads keep the maximum bounds and stable distant pages", () => {
  const store = new HomeFeedStore();

  assert.equal(
    store.ranked({ filters, page: 0, pageSize: 200 }).coins.length,
    8,
  );
  assert.deepEqual(
    store.ranked({
      filters,
      page: Math.floor(Number.MAX_SAFE_INTEGER / 200),
      pageSize: 200,
    }).coins,
    [],
  );
  assert.deepEqual(
    store.ranked({
      filters,
      page: Number.MAX_SAFE_INTEGER,
      pageSize: 200,
    }).coins,
    [],
  );
});

test("newest direct reads reject unsafe or out-of-range page sizes", () => {
  const store = new HomeFeedStore();

  for (const pageSize of [
    0,
    51,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    unsafe,
  ]) {
    assert.throws(
      () => store.newest({ filters, pageSize }),
      RangeError,
      `pageSize=${pageSize}`,
    );
  }
  assert.equal(store.newest({ filters, pageSize: 50 }).coins.length, 7);
});
