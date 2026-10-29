import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFollowList } from "../packages/frontend/src/lib/original-follow-list.mjs";

test("follow-list normalization rejects non-object response rows", () => {
  for (const row of [0, false, "", ["nested"]]) {
    assert.throws(() => normalizeFollowList([row]), TypeError);
  }

  assert.deepEqual(normalizeFollowList([{ user_id: "subject" }]), [
    {
      user_id: "subject",
      address: "",
      userId: "subject",
      kind: "person",
    },
  ]);
  assert.deepEqual(normalizeFollowList({ not: "an array" }), []);
});
