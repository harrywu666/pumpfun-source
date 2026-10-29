import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLeaderboardResponse } from "../packages/frontend/src/app/leaderboard/types.ts";

const source = {
  mode: "developer-api",
  label: "Pump developer API",
  fetchedAt: "2026-10-30T00:00:00.000Z",
};

function response(prizes) {
  return {
    ok: true,
    source,
    data: {
      kind: "competitions",
      upcoming: [
        {
          id: "synthetic-competition",
          slug: "synthetic-competition",
          kind: "group",
          title: "Synthetic competition",
          description: "Synthetic contract fixture",
          prizeCopy: "",
          prizes,
          minMembers: 2,
          maxMembers: 5,
          registrationOpensAt: null,
          registrationClosesAt: null,
          startsAt: null,
          endsAt: null,
          maxEntries: 100,
          entriesCount: 0,
          participants: 0,
          joinable: false,
          phase: "upcoming",
          isFinal: false,
        },
      ],
      live: [],
      past: [],
    },
  };
}

test("accepts single-rank and ascending range prize tiers", () => {
  assert.doesNotThrow(() =>
    parseLeaderboardResponse(
      response([
        { rankFrom: 1, rankTo: 1, amount: "$1,000" },
        { rankFrom: 2, rankTo: 5, amount: "$100 each" },
      ]),
    ),
  );
});

test("rejects non-ordinal and reversed competition prize tiers", () => {
  for (const prizes of [
    [{ rankFrom: 5, rankTo: 1, amount: "$1,000" }],
    [{ rankFrom: 2, rankTo: 1, amount: "$100" }],
    [{ rankFrom: 0, rankTo: 1, amount: "$100" }],
    [{ rankFrom: 1.5, rankTo: 2, amount: "$100" }],
    [{ rankFrom: 1, rankTo: Number.MAX_SAFE_INTEGER + 1, amount: "$100" }],
  ]) {
    assert.throws(
      () => parseLeaderboardResponse(response(prizes)),
      /invalid response/,
    );
  }
});
