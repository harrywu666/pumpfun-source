import test from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from './with-api-key.js';
for (const side of ['followers','following']) test(`${side} search counts Unicode code points`,async()=>{
  const app=buildApp();
  try {
    const request=(term:string)=>app.inject({url:`/v1/following/v3/${side}/search/user-001?searchTerm=${encodeURIComponent(term)}`});
    assert.equal((await request('😀'.repeat(50))).statusCode,200);
    assert.equal((await request(` ${'😀'.repeat(50)} `)).statusCode,200);
    const rejected=await request('😀'.repeat(51));
    assert.equal(rejected.statusCode,400);
    assert.equal(rejected.json().received,51);
    const paddedRejected=await request(` ${'😀'.repeat(51)} `);
    assert.equal(paddedRejected.statusCode,400);
    assert.equal(paddedRejected.json().received,51);
    assert.equal((await request('x'.repeat(50))).statusCode,200);
  } finally {await app.close();}
});
