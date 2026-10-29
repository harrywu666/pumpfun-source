import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CompetitionStore,type RawCompetition} from '../src/competitions-store.js';
import {UserStore} from '../src/users-store.js';
test('walletless profiles remain null in public competition rows',()=>{
  const seed=JSON.parse(readFileSync(new URL('../src/competitions-seed.json',import.meta.url),'utf8')) as RawCompetition[];
  const comp=structuredClone(seed.find(row=>row.kind==='person'&&row.entries.some(entry=>entry.lastRefreshedAtMs>0))!);
  assert.ok(comp);comp.entries=comp.entries.slice(0,1);comp.entries[0].participantId='walletless';
  for (const token of comp.entries[0].highlightTokens ?? []) for (const member of token.members) member.userId='walletless';
  const users=new UserStore([{address:'',userId:'walletless',username:'Synthetic',profile_image:null,bio:null,followers:0,following:0,x_username:null}]);
  const store=new CompetitionStore([comp],users);
  assert.equal(store.getByIdOrSlug(comp.id)!.leaderboard.entries[0].walletAddress,null);
  assert.equal(store.getEntryDetail(comp.id,comp.entries[0].entryId)!.entry.walletAddress,null);
});
