/** SDK/IDL source attribution only. No captured frontend JS is executed. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import assert from 'node:assert/strict';
import { decodeSource, exactlyOne, findNodes, sha256 } from '../original-contracts/source.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sdkRequire = createRequire(new URL('../../packages/sdk/package.json', import.meta.url));
const sdk = sdkRequire('./dist/index.js');
const archive = await readFile(`${root}/evidence/sdk/pump-sdk-4.3.1.tgz`);
assert.equal(sha256(archive), 'c8ff4e850651c81e9f488bfc6dffb4513a041bb4bca0819879dc19d9a72a4641');
const paths = ['src/idl/pump.json', 'src/sdk.ts', 'src/onlineSdk.ts', 'src/pda.ts', 'src/state.ts'];
const sources = new Map();
for (const path of paths) {
  const bytes = await readFile(`${root}/packages/sdk/${path}`);
  assert.deepEqual(bytes, execFileSync('tar', ['-xOf', `${root}/evidence/sdk/pump-sdk-4.3.1.tgz`, `package/${path}`]));
  const decoded = decodeSource(bytes);
  sources.set(path, { bytes, ...decoded, ...(path.endsWith('.ts') ? { ast: parse(decoded.text, { sourceType: 'module', plugins: ['typescript'] }) } : {}) });
}
const idl = JSON.parse(sources.get('src/idl/pump.json').text);
const types = new Map(idl.types.map(type => [type.name, type.type]));
function width(type) {
  if (typeof type === 'string') {
    const n = { bool: 1, u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, u64: 8, i64: 8, u128: 16, i128: 16, pubkey: 32 }[type];
    if (!n) throw new Error(`unsupported fixed IDL type ${type}`);
    return n;
  }
  if (type.array && Number.isSafeInteger(type.array[1])) return width(type.array[0]) * type.array[1];
  if (type.defined) {
    const definition = types.get(typeof type.defined === 'string' ? type.defined : type.defined.name);
    assert.equal(definition?.kind, 'struct');
    return definition.fields.reduce((sum, field) => sum + width(field.type), 0);
  }
  throw new Error(`unsupported dynamic IDL type ${JSON.stringify(type)}`);
}
function layout(name, selected, minimumField) {
  const definition = types.get(name); assert.equal(definition?.kind, 'struct');
  const fields = {}; let offset = 8; let minimumSize;
  for (const field of definition.fields) {
    if (field.name === minimumField) minimumSize = offset;
    const end = offset + width(field.type);
    if (selected.includes(field.name)) fields[field.name] = [offset, end];
    offset = end;
  }
  if (minimumField) assert.ok(Number.isSafeInteger(minimumSize), `${name} minimum layout field`);
  assert.equal(Object.keys(fields).length, selected.length);
  const account = exactlyOne(idl.accounts.filter(account => account.name === name), `${name} account`);
  return { size: offset, ...(minimumField ? { minimumSize } : {}), discriminator: account.discriminator, fields };
}
const accounts = {
  // The published 4.3.1 source identifies the pre-configurable-fee layout as the oldest live Global.
  Global: layout('Global', ['holder_reward_claim_authority', 'is_holder_reward_enabled'], 'creator_fee_configurable'),
  BondingCurve: layout('BondingCurve', ['creator', 'is_holder_reward']),
};
assert.equal(accounts.Global.size, sdk.GLOBAL_SIZE);
assert.equal(accounts.Global.minimumSize, 1045);
assert.equal(accounts.BondingCurve.size, sdk.BONDING_CURVE_SIZE);
assert.equal(idl.address, sdk.PUMP_PROGRAM_ID.toBase58());
const contract = { sdkVersion: '4.3.1', programId: idl.address, globalPda: sdk.GLOBAL_PDA.toBase58(), accounts };
function witness(path, predicate, label) {
  const source = sources.get(path); const node = exactlyOne(findNodes(source.ast, predicate), label);
  const byteStart = source.byteOffsets[node.start], byteEnd = source.byteOffsets[node.end];
  assert.ok(byteStart >= 0 && byteEnd >= byteStart);
  return { label, path: `packages/sdk/${path}`, sourceSha256: sha256(source.bytes), utf16: [node.start, node.end], utf8: [byteStart, byteEnd], sha256: sha256(source.bytes.subarray(byteStart, byteEnd)) };
}
const method = (name) => node => node.type === 'ClassMethod' && node.key.type === 'Identifier' && node.key.name === name;
const rpcBytes = await readFile(`${root}/packages/frontend/src/app/portfolio/rpc.ts`);
const rpcText = rpcBytes.toString('utf8');
const rpcAst = parse(rpcText, { sourceType: 'module', plugins: ['typescript'] });
const rpcFactory = exactlyOne(findNodes(rpcAst, node => node.type === 'FunctionDeclaration' && node.id?.name === 'createPinnedRpcCall'), 'used shared RPC factory');
const rpcBodySha256 = sha256(rpcText.slice(rpcFactory.body.start, rpcFactory.body.end));
assert.equal(rpcBodySha256, '49c42e491310e985a652dbfdcb553a9edfdbb58c16acd3005f63e7daafa41ab1');
const proof = { authority: 'Published npm SDK source and fixed-width IDL; no claim of private backend or original frontend implementation', archiveSha256: sha256(archive),
  transport: { controlRevision: '03bcf6a0b8162919a72b884869850abf342aa9d3', controlSourceSha256: '35c2f27cdb7965711dcc89a572cb6740d8f067c26f6d74dd0c7e7e6f3516d0e8', currentSourceSha256: sha256(rpcBytes), unchangedFactoryBodySha256: rpcBodySha256, delta: 'export existing factory; add readonly getMultipleAccounts to TypeScript method union only' },
  sources: paths.map(path => ({ path: `packages/sdk/${path}`, sha256: sha256(sources.get(path).bytes) })),
  witnesses: [
    witness('src/sdk.ts', method('decodeGlobal'), 'Public Global decoder zero-pads legacy bytes'),
    witness('src/sdk.ts', method('decodeBondingCurve'), 'Public curve decoder zero-pads legacy bytes'),
    witness('src/sdk.ts', node => node.type === 'FunctionDeclaration' && node.id.name === 'zeroPadded', 'Actual padding helper'),
    witness('src/sdk.ts', node => node.type === 'FunctionDeclaration' && node.id.name === 'assertCreateV2FlagsAllowed', 'Actual creation flag guard'),
    witness('src/onlineSdk.ts', method('adminCtoInstructions'), 'Actual conversion guard is conditional on converting an existing non-holder coin'),
    witness('src/onlineSdk.ts', method('fetchCurveWithQuote'), 'Used global/curve getMultipleAccountsInfo pair and public decoder calls'),
    witness('src/onlineSdk.ts', method('distributeFeeToHoldersInstructions'), 'Used holder flag check; read unit never calls this transaction builder'),
    witness('src/pda.ts', node => node.type === 'FunctionDeclaration' && node.id.name === 'bondingCurvePda', 'Actual mint-bound curve PDA derivation'),
  ],
  limitations: ['SDK decoder padding is not evidence that a flag was encoded in an older account', 'Global flag concerns creation/conversion; it is not a general existing-coin payout switch', 'No eligibility, claim amount, authenticated owner, signing or original service parity is inferred'] };
for (const [relative, value] of [
  ['packages/frontend/src/app/holder-rewards-config/contract.json', contract],
  ['research/holder-rewards-config-20261029/SOURCE.json', proof],
]) {
  const target = new URL(`../../${relative}`, import.meta.url);
  const expected = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--check')) assert.equal(await readFile(target, 'utf8'), expected, relative);
  else { await mkdir(new URL('.', target), { recursive: true }); await writeFile(target, expected); }
}
console.log('Published SDK/IDL config contract verified: 5 archive-equal sources, 8 static method witnesses, exact field ranges');
