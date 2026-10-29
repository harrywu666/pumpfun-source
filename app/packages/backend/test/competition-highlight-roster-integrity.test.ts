import test from 'node:test';
import assert from 'node:assert/strict';
import seed from '../src/competitions-seed.json' with { type: 'json' };
import {
  CompetitionStore,
  type RawCompetition,
} from '../src/competitions-store.js';

function groupCompetitionWithHighlightMember(userId: string): RawCompetition {
  const competition = structuredClone(
    seed.find(candidate =>
      candidate.kind === 'group' &&
      candidate.entries.some(entry =>
        (entry.members?.length ?? 0) > 0 &&
        entry.highlightTokens?.some(token => token.members.length > 0),
      ),
    ),
  ) as unknown as RawCompetition | undefined;
  assert.ok(competition, 'expected a group competition with roster highlights');

  const entry = competition.entries.find(candidate =>
    (candidate.members?.length ?? 0) > 0 &&
    candidate.highlightTokens?.some(token => token.members.length > 0),
  );
  assert.ok(entry, 'expected a roster entry with highlight members');
  entry.highlightTokens![0].members[0].userId = userId;
  return competition;
}

test('highlight members must belong to the entry snapshot roster', () => {
  const competition = groupCompetitionWithHighlightMember('outside-roster-user');
  assert.throws(
    () => new CompetitionStore([competition]),
    /highlight member.*roster/i,
  );
});

test('highlight members drawn from the entry snapshot roster remain accepted', () => {
  const competition = groupCompetitionWithHighlightMember('user-001');
  assert.doesNotThrow(() => new CompetitionStore([competition]));
});
