import test from 'node:test';
import assert from 'node:assert/strict';
import {readBoundedJson,MAX_UPSTREAM_BYTES} from '../packages/frontend/src/app/api/leaderboard/upstream.ts';
test('rejects JSON-looking bodies with non-JSON media types',async()=>{
  for(const contentType of ['text/plain; charset=utf-8','text/html']){
    let canceled=false;
    const response=new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-type':contentType}});
    await assert.rejects(readBoundedJson(response),/not JSON/);
    assert.equal(canceled,true);
    assert.equal(response.body?.locked,false);
  }
});
test('invalid UTF-8 inside otherwise valid JSON fails instead of becoming replacement text',async()=>{
  const bytes=Uint8Array.from([123,34,120,34,58,34,255,34,125]);
  const response=new Response(bytes,{headers:{'content-type':'application/json'}});
  await assert.rejects(readBoundedJson(response),/not JSON/);
  assert.equal(response.body.locked,false);
});
test('successful parsing and read failures release the reader lock',async()=>{
  const good=new Response('{"text":"😀"}',{headers:{'content-type':'Application/JSON; Charset=UTF-8'}});
  assert.deepEqual(await readBoundedJson(good),{text:'😀'});
  assert.equal(good.body.locked,false);
  const bad=new Response(new ReadableStream({pull(controller){controller.error(new Error('read failed'));}}),{headers:{'content-type':'application/json'}});
  await assert.rejects(readBoundedJson(bad),/read failed/);
  assert.equal(bad.body.locked,false);
});
test('oversized declared or streamed bodies cancel and unlock',async()=>{
  let canceled=false;
  const declared=new Response(new ReadableStream({cancel(){canceled=true;}}),{headers:{'content-length':String(MAX_UPSTREAM_BYTES+1)}});
  await assert.rejects(readBoundedJson(declared),/too large/);
  assert.equal(canceled,true);
  const streamed=new Response(new Uint8Array(MAX_UPSTREAM_BYTES+1),{headers:{'content-type':'application/json'}});
  await assert.rejects(readBoundedJson(streamed),/too large/);
  assert.equal(streamed.body.locked,false);
});
