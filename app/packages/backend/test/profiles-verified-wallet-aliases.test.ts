import assert from "node:assert/strict";
import test from "node:test";
import { buildApp, TEST_API_KEY } from "./with-api-key.js";
import { UserStore, type User } from "../src/users-store.js";

test("verified profile batches resolve every wallet alias on a user row", async (t) => {
  const canonicalEvmWallet = "0x1234567890abcdef1234567890abcdef12345678";
  const row: User = {
    address: "So11111111111111111111111111111111111111112",
    userId: "user-with-evm-wallet",
    username: "evm_wallet_user",
    profile_image: null,
    bio: null,
    followers: 0,
    following: 0,
    x_username: null,
    canonical_svm_wallet: "So11111111111111111111111111111111111111112",
    canonical_evm_wallet: canonicalEvmWallet,
  };
  const app = buildApp([], { userStore: new UserStore([row], [row.userId!]) });
  t.after(() => app.close());
  const base = await app.listen({ host: "127.0.0.1", port: 0 });

  const response = await fetch(`${base}/v1/profiles/verified`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TEST_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      ids: [row.userId, row.address, canonicalEvmWallet, "unknown-user"],
    }),
  });

  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), {
    [row.userId!]: true,
    [row.address]: true,
    [canonicalEvmWallet]: true,
    "unknown-user": false,
  });
});

test("canonical wallet aliases cannot point at two different profiles", () => {
  const canonicalEvmWallet = "0x1234567890abcdef1234567890abcdef12345678";
  const row: User = {
    address: "wallet-a",
    userId: "user-a",
    username: "a",
    profile_image: null,
    bio: null,
    followers: 0,
    following: 0,
    x_username: null,
    canonical_evm_wallet: canonicalEvmWallet,
  };

  assert.throws(
    () =>
      new UserStore([
        row,
        {
          ...row,
          address: "wallet-b",
          userId: "user-b",
        },
      ]),
    /ambiguous/i,
  );
});
