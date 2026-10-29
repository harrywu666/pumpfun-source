// Static source adaptation only. No eval, VM, original runtime or bundle imports.
import assert from 'node:assert/strict';
import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import { generate } from '@babel/generator';
import { openCorpus, exactlyOne, findNodes, member, literal, sha256 } from '../source.mjs';
import { contexts } from './contexts.mjs';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const kernelDir = 'packages/frontend/src/original-contracts/auth/kernels';
const receiptFile = 'research/original-auth-session-20261028/PROVENANCE.json';
const id = (name) => ({ type: 'Identifier', name });
const property = (name, value) => ({ type: 'ObjectProperty', key: id(name), value, computed: false, shorthand: false });
const code = (node) => generate(node, { comments: false }).code;
const statement = (text) => parse(text, { sourceType: 'module' }).program.body[0];

// Ignore source locations and formatting, never operators, values or identifiers.
export function structural(node) {
  if (Array.isArray(node)) return node.map(structural);
  if (!node || typeof node !== 'object') return node;
  const result = {};
  for (const [key, value] of Object.entries(node)) {
    if (!['start', 'end', 'loc', 'extra', 'leadingComments', 'trailingComments', 'innerComments', 'comments'].includes(key)) {
      if (value !== null && value !== undefined) result[key] = structural(value);
    }
  }
  return result;
}

export function assertAdapted(actual, expected, label) {
  assert.deepEqual(structural(parse(actual, { sourceType: 'module' }).program),
    structural(parse(expected, { sourceType: 'module' }).program), `${label}: adapted AST differs from original-backed transform`);
}

function exportsOf(factory, names) {
  const last = factory.node.body.body.at(-1);
  assert.equal(last.type, 'ExpressionStatement');
  const call = last.expression;
  assert.ok(member(call.callee, factory.runtime, 's'));
  const entries = call.arguments[0];
  assert.equal(entries.type, 'ArrayExpression');
  assert.equal(entries.elements.length, names.length * 3);
  const exports = new Map();
  for (let i = 0; i < entries.elements.length; i += 3) {
    const name = literal(entries.elements[i]);
    assert.equal(name, names[i / 3]);
    assert.equal(literal(entries.elements[i + 1]), 0);
    exports.set(name, entries.elements[i + 2]);
  }
  return { exports, last };
}

function adaptation(factory, kind) {
  const names = kind === 'reader' ? ['c', 'i', 'I', 'D', 's'] : ['S', 'e'];
  const { exports, last } = exportsOf(factory, names);
  const body = factory.node.body.body.filter((node) => node !== last);
  const params = [];
  const witnesses = [];
  if (kind === 'reader') {
    for (const moduleId of [352386, 683023]) {
      const declaration = exactlyOne(body.filter((node) => node.type === 'VariableDeclaration' &&
        node.declarations.length === 1 && member(node.declarations[0].init?.callee, factory.runtime, 'i') &&
        node.declarations[0].init.arguments[0]?.value === moduleId), `reader import ${moduleId}`);
      params.push(declaration.declarations[0].id);
      witnesses.push(factory.witness(declaration, `runtime import ${moduleId}`));
      body.splice(body.indexOf(declaration), 1);
    }
    params.push(id('browserPorts'));
    body.unshift(statement('const {document,window,localStorage,location,Date} = browserPorts;'));
  } else params.push(id('atob'));
  for (const node of factory.node.body.body.filter((node) => node !== last)) {
    witnesses.push(factory.witness(node, 'original declaration'));
  }
  const props = [...exports].map(([name, value]) => {
    witnesses.push(factory.witness(value, `export ${name}`));
    return property(name, value);
  });
  if (kind === 'reader') {
    const hook = exactlyOne(findNodes(exports.get('s'), (node) => node.type === 'CallExpression' &&
      node.callee.type === 'SequenceExpression' &&
      node.callee.expressions.at(-1).type === 'MemberExpression' &&
      node.callee.expressions.at(-1).property.name === 'useSyncExternalStore'), 'external store hook');
    assert.equal(hook.arguments.length, 3);
    assert.ok(hook.arguments.every((node) => node.type === 'Identifier'));
    assert.deepEqual(structural(hook.arguments[1]), structural(exports.get('D')));
    // Expose existing functions for deterministic lifecycle/SSR tests; no new behavior.
    props.push(property('subscribe', hook.arguments[0]), property('getServerSnapshot', hook.arguments[2]));
    witnesses.push(factory.witness(hook, 'useSyncExternalStore binding'));
  }
  body.push({ type: 'ReturnStatement', argument: { type: 'ObjectExpression', properties: props } });
  const node = { type: 'ExportNamedDeclaration', declaration: { type: 'FunctionDeclaration',
    id: id(kind === 'reader' ? 'createReaderKernel' : 'createDecoderKernel'), params,
    body: { type: 'BlockStatement', body }, async: false, generator: false }, specifiers: [], source: null };
  const output = `// Source-adapted original ${factory.id}; SHA256 ${factory.provenance.sha256}.\n` +
    '// Generated from authenticated raw AST. Browser/runtime dependencies are injected.\n' + code(node) + '\n';
  return { output, witnesses };
}

async function allOrigins(corpus, factory) {
  const variant = exactlyOne(corpus.index.modules.filter((entry) => entry.sha256 === factory.provenance.sha256), 'variant');
  const origins = [];
  for (const origin of variant.origins) {
    const found = await corpus.factory(factory.id, { source: origin.source });
    assert.equal(found.provenance.sha256, variant.sha256);
    origins.push(found.provenance);
  }
  return origins;
}

async function consumerWitness(corpus) {
  const consumer = await corpus.factory(589428, { source: 'evidence/web/objects/9bafadffbe6dc98b.js' });
  assert.equal(consumer.provenance.sha256, '4d12898c1c6cd0bc4e8518537175ecf57e5edf14a6723c4c15f8aad0bf97a400');
  const imports = exactlyOne(findNodes(consumer.node, (node) => node.type === 'VariableDeclarator' &&
    member(node.init?.callee, consumer.runtime, 'i') && node.init.arguments[0]?.value === 350741), 'consumer reader import');
  const binding = imports.id.name;
  const hooks = findNodes(consumer.node, (node) => node.type === 'CallExpression' &&
    node.callee.type === 'SequenceExpression' && member(node.callee.expressions.at(-1), binding, 's'));
  assert.equal(hooks.length, 4, 'four original reader-hook references');
  const clear = exactlyOne(findNodes(consumer.node, (node) => node.type === 'CallExpression' &&
    node.callee.type === 'SequenceExpression' && member(node.callee.expressions.at(-1), binding, 'c')), 'consumer clear cookie');
  const logout = exactlyOne(findNodes(consumer.node, (node) => node.type === 'CallExpression' &&
    node.arguments[0]?.type === 'StringLiteral' && node.arguments[0].value === 'POST /auth/logout'), 'consumer logout request');
  const registration = exactlyOne(findNodes(consumer.node, (node) => node.type === 'CallExpression' &&
    member(node.callee, consumer.runtime, 's')), 'consumer exports');
  assert.ok(registration.arguments[0].elements.some((node) => node?.value === 'AuthProviders'));
  return { factory: consumer.provenance, origins: await allOrigins(corpus, consumer),
    witnesses: [consumer.witness(imports, 'reader import'), ...hooks.map((node) => consumer.witness(node, 'reader hook')),
      consumer.witness(clear, 'cookie clear'), consumer.witness(logout, 'logout request'),
      consumer.witness(registration, 'AuthProviders export')],
    limitation: 'Consumer imports numeric ID350741; no cross-chunk variant selection is asserted. Full provider and backend auth remain unrecovered.' };
}

async function publishAtomically(root, publications) {
  const rootPath = path.resolve(root);
  const entries = [];
  for (const { relative, content } of publications) {
    const destination = path.resolve(rootPath, relative);
    const relation = path.relative(rootPath, destination);
    if (!relation || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
      throw new Error(`unsafe publication path: ${relative}`);
    }
    try {
      const metadata = await lstat(destination);
      if (!metadata.isFile()) throw new Error(`publication target is not a regular file: ${relative}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    entries.push({ relative, content, destination, staged: null, backup: null, published: false });
  }
  try {
    for (const entry of entries) {
      entry.staged = path.join(path.dirname(entry.destination),
        `.${path.basename(entry.destination)}.${process.pid}.${randomUUID()}.tmp`);
      await writeFile(entry.staged, entry.content, { flag: 'wx' });
    }
    for (const entry of entries) {
      try {
        await lstat(entry.destination);
        entry.backup = path.join(path.dirname(entry.destination),
          `.${path.basename(entry.destination)}.${process.pid}.${randomUUID()}.bak`);
        await rename(entry.destination, entry.backup);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await rename(entry.staged, entry.destination);
      entry.staged = null;
      entry.published = true;
    }
  } catch (error) {
    for (const entry of entries.reverse()) {
      if (entry.published) await rm(entry.destination, { force: true }).catch(() => {});
      if (entry.backup) await rename(entry.backup, entry.destination).catch(() => {});
      if (entry.staged) await rm(entry.staged, { force: true }).catch(() => {});
    }
    throw error;
  }
  for (const entry of entries) if (entry.backup) await rm(entry.backup, { force: true });
}

export async function recover({ check = true, outputRoot = appRoot } = {}) {
  const corpus = await openCorpus(appRoot);
  const receipt = { schemaVersion: 1, anchors: corpus.anchors,
    scope: 'Unverified original browser UI claims only; no backend authorization.', contexts: [],
    consumer: await consumerWitness(corpus) };
  const publications = [];
  for (const context of contexts) {
    const entry = { source: context.source, variants: [] };
    for (const [kind, moduleId] of [['reader', 350741], ['decoder', 683023]]) {
      const factory = await corpus.factory(moduleId, { source: context.source });
      assert.equal(factory.provenance.sha256, context[kind]);
      const { output, witnesses } = adaptation(factory, kind);
      const relative = `${kernelDir}/${kind}-${context[kind].slice(0, 12)}.mjs`;
      publications.push({ relative, content: output });
      entry.variants.push({ kind, path: relative, sourceAdaptedSha256: sha256(output),
        factory: factory.provenance, origins: await allOrigins(corpus, factory), witnesses });
    }
    receipt.contexts.push(entry);
  }
  const json = JSON.stringify(receipt, null, 2) + '\n';
  publications.push({ relative: receiptFile, content: json });
  if (check) {
    for (const { relative, content } of publications.slice(0, -1)) {
      const actual = await readFile(path.join(outputRoot, relative), 'utf8');
      assertAdapted(actual, content, relative);
      assert.equal(sha256(actual), sha256(content), `${relative}: generated bytes changed`);
    }
    assert.deepEqual(JSON.parse(await readFile(path.join(outputRoot, receiptFile), 'utf8')), receipt,
      'provenance changed: review authenticated source/index before regenerating');
  } else await publishAtomically(outputRoot, publications);
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.ok(process.argv.slice(2).every((arg) => arg === '--write'), 'only --write or no arguments accepted');
  const receipt = await recover({ check: !process.argv.includes('--write') });
  console.log(`Original auth: ${receipt.contexts.length} source contexts, 6 preserved variants, consumer witnesses verified.`);
}
