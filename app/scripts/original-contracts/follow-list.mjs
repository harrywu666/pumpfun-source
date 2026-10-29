import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCorpus, findNodes, exactlyOne, objectProperty, propertyName, member, literal, sha256 } from './source.mjs';
import { createSchemaExtractor } from './schema.mjs';

const pins = {
  manifestSha256: '9e0fc00719eb8c919dd4205d3c118eb48c4927e056c77e8343e26d6f7189bbb5',
  inventorySha256: '1d268ae7f2eb0f61eaaffd222269bf29d9ce06e9946372861721b2f159d868e2',
};
const operations = [
  'GET /following/v3/followers/{userId}', 'GET /following/v3/followers/search/{userId}',
  'GET /following/v3/following/{userId}', 'GET /following/v3/following/search/{userId}',
];
const implementation = 'packages/frontend/src/lib/original-follow-list.mjs';
const sourceContexts = {
  500056: 'evidence/web/objects/eb0b23ee6feb7543.js',
  759257: 'evidence/web/objects/1e479323ffe53c14.js',
  503630: 'evidence/web/objects/1e479323ffe53c14.js',
  30181: 'evidence/web/objects/01ad4f413e529b60.js',
  402030: 'evidence/web/objects/2b47dd0b38a1608f.js',
  898661: 'evidence/web/objects/2b47dd0b38a1608f.js',
  183184: 'evidence/web/objects/2b47dd0b38a1608f.js',
  785036: 'evidence/web/objects/2b47dd0b38a1608f.js',
  972407: 'evidence/web/objects/2b47dd0b38a1608f.js',
  896727: 'evidence/web/objects/2b47dd0b38a1608f.js',
  890664: 'evidence/web/objects/2b47dd0b38a1608f.js',
  617159: 'evidence/web/objects/2b47dd0b38a1608f.js',
};

function exported(factory, id, name) {
  const call = exactlyOne(findNodes(factory.node, (node) => node.type === 'CallExpression' &&
    member(node.callee, factory.runtime, 's') && node.arguments[1]?.value === id), `registration ${id}`);
  const entries = call.arguments[0].elements;
  const values = [];
  for (let index = 0; index < entries.length; index += 3) {
    if (entries[index]?.value === name && entries[index + 1]?.value === 0) values.push(entries[index + 2]);
  }
  return exactlyOne(values, `export ${id}.${name}`);
}
function imported(factory, id) {
  return exactlyOne(findNodes(factory.node, (node, parents) => node.type === 'VariableDeclarator' &&
    node.init?.type === 'CallExpression' && ['i', 'r'].some((method) => member(node.init.callee, factory.runtime, method)) &&
    node.init.arguments[0]?.value === id && !parents.some((parent) => parent !== factory.node && /Function|Method/.test(parent.type))), `import ${id}`);
}
function calls(node, namespace, name) {
  return findNodes(node, (entry) => entry.type === 'CallExpression' &&
    member(entry.callee.type === 'SequenceExpression' ? entry.callee.expressions.at(-1) : entry.callee, namespace, name));
}

export async function extractFollowList(root) {
  const corpus = await openCorpus(root);
  for (const [name, expected] of Object.entries(pins)) if (corpus.anchors[name] !== expected) throw new Error(`unreviewed follow-list input: ${name}`);
  const fragments = new Map();
  const factories = new Map();
  const add = (factory, node, label) => {
    const value = factory.witness(node, label);
    const key = `${value.source}:${value.utf16.join(':')}`;
    fragments.set(key, { ...value, text: factory.text(node) });
    return key;
  };
  const factory = async (id) => {
    const value = await corpus.factory(id, sourceContexts[id] ? { source: sourceContexts[id] } : {});
    factories.set(id, value.provenance);
    return value;
  };
  // The shared factory also contains a mutation hook350989. Select the actual
  // registration500056.Q; do not treat the entire factory as our workflow.
  const source = await factory(500056);
  const registration = exactlyOne(findNodes(source.node, (node) => node.type === 'CallExpression' &&
    member(node.callee, source.runtime, 's') && node.arguments[1]?.value === 500056), 'module500056 registration');
  const entries = registration.arguments[0].elements;
  const qIndex = entries.findIndex((entry) => entry?.value === 'Q');
  if (qIndex < 0 || entries[qIndex + 1]?.value !== 0) throw new Error('missing module500056.Q');
  const hook = entries[qIndex + 2];
  const hookFragment = add(source, hook, 'module500056.Q read workflow');
  const queryCallback = exactlyOne(findNodes(hook, (node) => node.type === 'ArrowFunctionExpression' && node.async), 'actual async follow-list query callback');
  const queryCallbackFragment = add(source, queryCallback, 'actual awaited read and normalization callback');
  const request = exactlyOne(findNodes(hook, (node) => node.type === 'ArrowFunctionExpression' &&
    node.params.length === 4 && node.params[2]?.type === 'ObjectPattern'), 'follow-list request selector');
  add(source, request, 'four-way plain/search/direction request selector');
  const literals = findNodes(request, (node) => node.type === 'StringLiteral' && node.value.startsWith('GET ')).map((node) => node.value).sort();
  if (JSON.stringify(literals) !== JSON.stringify([...operations].sort())) throw new Error('follow-list operation set changed');
  const map = exactlyOne(findNodes(hook, (node) => node.type === 'CallExpression' &&
    propertyName(node.callee.property) === 'map'), 'follow-list row mapper use');
  const mapper = exactlyOne(findNodes(source.node, (node, parents) => node.type === 'VariableDeclarator' &&
    node.id.name === map.arguments[0].name && !parents.some((parent) => parent !== source.node && /Function|Method/.test(parent.type))), 'follow-list row mapper declaration');
  add(source, mapper.init, 'follow-list row normalization');
  const defaultSort = exactlyOne(findNodes(source.node, (node, parents) => node.type === 'VariableDeclarator' &&
    node.init?.type === 'StringLiteral' && node.init.value === 'followers' &&
    !parents.some((parent) => parent !== source.node && /Function|Method/.test(parent.type))), 'default follow-list sort');
  add(source, defaultSort, 'default follow-list sort binding');
  const prefix = exactlyOne(findNodes(source.node, (node) => node.type === 'ArrayExpression' &&
    node.elements.length === 1 && node.elements[0]?.value === 'follow-list'), 'follow-list query prefix');
  add(source, prefix, 'follow-list query-key prefix');
  const policy = exactlyOne(findNodes(hook, (node) => node.type === 'ObjectExpression' &&
    node.properties.some((property) => propertyName(property.key) === 'refetchIntervalInBackground')), 'follow-list query policy');
  const queryPolicy = Object.fromEntries(['staleTime', 'refetchInterval', 'refetchIntervalInBackground', 'refetchOnWindowFocus']
    .map((name) => [name, literal(objectProperty(policy, name))]));
  const slice = exactlyOne(findNodes(hook, (node) => node.type === 'CallExpression' &&
    propertyName(node.callee.property) === 'slice'), 'local follow-list slice');
  if (slice.arguments[1]?.type !== 'BinaryExpression' || slice.arguments[1].operator !== '+' ||
      slice.arguments[1].right.value !== 10) throw new Error('local page slice changed');
  add(source, slice, 'local ten-row display slice');
  const pageIdentity = exactlyOne(findNodes(hook, (node) => node.type === 'TemplateLiteral'), 'local page identity');
  add(source, pageIdentity, 'page-reset identity without direction');
  const websiteClientImport = exactlyOne(findNodes(source.node, (node) => node.type === 'VariableDeclarator' &&
    node.init?.type === 'CallExpression' && member(node.init.callee, source.runtime, 'i') && node.init.arguments[0]?.value === 759257), 'follow-list website client import');
  add(source, websiteClientImport.init, 'follow-list imports website client');

  const client = await factory(759257);
  const websiteConstructor = imported(client, 30181);
  const websiteOrigin = imported(client, 503630);
  const j = exported(client, 759257, 'j');
  const jConstructorCall = exactlyOne(calls(j, websiteConstructor.id.name, 'K'), 'j invokes website K');
  const jOriginCall = exactlyOne(calls(j, websiteOrigin.id.name, 'R'), 'j resolves website origin R');
  exactlyOne(calls(request, websiteClientImport.id.name, 'j'), 'actual follow-list selector invokes j');
  const defaults = exactlyOne(findNodes(client.node, (node) => node.type === 'ObjectExpression' &&
    node.properties.some((property) => propertyName(property.key) === 'credentials' && property.value?.value === 'same-origin')), 'website client defaults');
  add(client, client.node, 'website j factory, default merge and inactive internal key hook');
  const credentials = literal(objectProperty(defaults, 'credentials'));
  const credentialsOverrides = findNodes(request, (node) => node.type === 'ObjectProperty' && propertyName(node.key) === 'credentials');
  if (credentialsOverrides.length) throw new Error('follow-list credentials override introduced');
  const origins = await factory(503630);
  const origin = exactlyOne(findNodes(origins.node, (node) => node.type === 'ArrowFunctionExpression' &&
    node.body.type === 'StringLiteral' && node.body.value === 'https://frontend-api-v3.pump.fun'), 'website follow origin');
  add(origins, origin, 'website follow-list origin');
  const http = await factory(30181);
  const barrelImport = imported(http, 402030);
  const k = exported(http, 30181, 'K');
  const kConstructorCall = exactlyOne(calls(k, barrelImport.id.name, 'createContractClient'), 'K calls actual contract-client reexport');
  const extension = kConstructorCall.arguments[0];
  if (extension?.type !== 'CallExpression' || propertyName(extension.callee?.property) !== 'extend' ||
      extension.callee.object?.type !== 'CallExpression' || extension.callee.object.callee.type !== 'Identifier') throw new Error('website K default-extension shape changed');
  const baseName = extension.callee.object.callee.name;
  const baseConstructor = exactlyOne(findNodes(http.node, (node, parents) => node.type === 'VariableDeclarator' &&
    node.id.name === baseName && !parents.some((parent) => parent !== http.node && /Function|Method/.test(parent.type))), 'actual base HTTP constructor');
  const include = exactlyOne(findNodes(baseConstructor.init, (node) => node.type === 'ObjectProperty' &&
    propertyName(node.key) === 'credentials'), 'base HTTP credential default');
  if (literal(include.value) !== 'include') throw new Error('base HTTP credential default changed');
  add(http, baseConstructor.init, 'shared base HTTP constructor, then extended by website defaults');
  add(http, k, 'shared K extension order retains explicit same-origin override');
  const barrel = await factory(402030);
  const clientImport = imported(barrel, 898661);
  const routeImport = imported(barrel, 972407);
  const routeSpread = exactlyOne(findNodes(barrel.node, (node) => node.type === 'SpreadElement' &&
    member(node.argument, routeImport.id.name, 'followingRoutes')), 'followingRoutes included in actual contract catalog');
  const clientReexport = exactlyOne(findNodes(barrel.node, (node) => node.type === 'CallExpression' &&
    member(node.callee, 'Object', 'defineProperty') && node.arguments[0]?.name === barrel.node.params[2]?.name &&
    node.arguments[1]?.value === 'createContractClient'), 'actual createContractClient getter');
  const returnedClient = exactlyOne(findNodes(clientReexport, (node) => node.type === 'ReturnStatement' &&
    member(node.argument, clientImport.id.name, 'createContractClient')), 'actual getter resolves898661');
  const contractClient = await factory(898661);
  const clientImplementation = exactlyOne(findNodes(contractClient.node, (node) => node.type === 'AssignmentExpression' &&
    member(node.left, contractClient.node.params[2]?.name, 'createContractClient') && node.right.type === 'ArrowFunctionExpression'), 'actual contract client implementation');
  for (const id of [183184, 785036]) await factory(id);
  const importEdges = [
    [500056, 759257, add(source, websiteClientImport.init, 'read workflow imports website759257')],
    [759257, 30181, add(client, jConstructorCall, 'j invokes actual K constructor')],
    [759257, 503630, add(client, jOriginCall, 'j invokes origin R')],
    [30181, 402030, add(http, kConstructorCall, 'K calls contract-client reexport')],
    [402030, 898661, add(barrel, returnedClient, 'actual client getter resolves898661')],
    [402030, 972407, add(barrel, routeSpread, 'followingRoutes included in actual catalog')],
  ].map(([from, to, witness]) => ({ from, to, witness }));
  add(contractClient, clientImplementation.right, 'shared actual request/path/query/json/error boundary (prior686/691 source)');
  const extractor = createSchemaExtractor(corpus, { sources: sourceContexts });
  const declaration = await extractor.declaration(972407, 'followingRoutes');
  const routes = declaration.node.arguments[0];
  const definitions = {};
  for (const operation of operations) {
    const wrapped = objectProperty(routes, operation);
    if (literal(wrapped.arguments[0]) !== 'graph.read') throw new Error('follow-list public scope changed');
    const route = wrapped.arguments[1];
    const fields = {};
    for (const name of ['params', 'query', 'response']) fields[name] = await extractor.compile(objectProperty(route, name), declaration.factory);
    const errors = route.properties.find((property) => propertyName(property.key) === 'errors');
    definitions[operation] = { scope: 'graph.read', summary: literal(objectProperty(route, 'summary')), ...fields,
      ...(errors ? { declaredErrors: Object.fromEntries(errors.value.properties.map((property) => [propertyName(property.key), literal(property.value)])) } : {}),
      source: add(declaration.factory, wrapped, `${operation} declaration`) };
  }
  const declarations = extractor.document({ 'x-follow-list-routes': definitions });
  for (const witness of extractor.witnesses()) {
    if (witness.label === 'declaration 972407.followingRoutes') continue;
    const key = `${witness.source}:${witness.utf16.join(':')}`;
    const capture = await corpus.capture(witness.source);
    fragments.set(key, { ...witness, ...(!witness.label.startsWith('factory ') ? { text: capture.text.slice(...witness.utf16) } : {}) });
  }
  return { formatVersion: 1,
    authority: 'Captured original read-client and declaration AST; independent pure reconstruction, no captured JavaScript evaluated',
    frozenInputs: corpus.anchors,
    implementation: { path: implementation, sha256: sha256(await fs.readFile(path.join(root, implementation))) },
    workflow: { module: 500056, export: 'Q', sharedFactory: source.provenance.sha256, source: hookFragment,
      operations, queryPolicy, queryCallback: queryCallbackFragment, plainFetchLimit: 1000, searchFetchLimit: 100, localPageSize: 10,
      totalCount: 'Length of fetched/normalized array, not remote graph count',
      normalization: 'Object rows are spread with address??empty, user_id??userId??null, kind??person; non-object rows throw TypeError (bounded reconstruction guard)',
      searchSelection: 'searchTerm !== undefined, including empty string and null',
      queryKey: ['follow-list', 'direction', 'userId', 'sort(default followers)', 'searchTerm??empty'],
      pageIdentity: '`${userId}|${sort}|${searchTerm??empty}`; direction is absent',
      pageState: 'Reset to1 only when listKey changes; retain prior page otherwise, with no clamp as array shrinks' },
    transport: { origin: origin.body.value, effectiveCredentials: credentials, importEdges,
      requestOverride: 'No credentials, Content-Type or Authorization override in the four-way request selector',
      sourceUnit: 'https://github.com/lalalune/pumpfun-source/pull/686',
      errors: 'The read selector installs no HTTP hooks; generic HTTP/error processing remains in shared transport, separately reconstructed inPR691',
      authUnknown: 'same-origin is the captured j default. No cookie, viewer identity or server authorization behavior is inferred' },
    declarations, factories: [...factories.values()], fragments: [...fragments.values()],
    limits: ['No API route/store, follow mutation, auth, synthetic graph, server pagination or compatibility qualification',
      'The actual registered export500056.Q is the entry boundary. No importing UI caller is established in retained captures; no reachability, rendered modal or observed interaction is claimed',
      'This is LOCAL display pagination of one bounded fetch, not an offset-driven infinite remote pager',
      'Absent and empty/null search terms share cache/local identity despite selecting different requests; preserved as source behavior',
      'Changing direction keeps the same local listKey; TanStack hashing/scheduling and surrounding UI may affect observed outcomes and are not reconstructed',
      'Normalizer retention of unknown fields is original CLIENT behavior, not a developer-host privacy projection or safe backend response builder',
      'The non-object row rejection is a bounded reconstruction guard, not a claim that the captured JavaScript enforced the declared response schema',
      'Read declarations retain optional viewer-relative fields; their descriptions are not runtime authorization policy',
      'The shared350989 factory also contains mutations and mutual-follower reads, which are outside this selected500056 workflow'] };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode] = process.argv.slice(2);
  if (process.argv.length !== 3 || !['--write', '--check'].includes(mode)) throw new Error('usage: follow-list.mjs --write|--check');
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const destination = path.join(root, 'contracts/original-follow-list.json');
  const result = `${JSON.stringify(await extractFollowList(root), null, 2)}\n`;
  if (mode === '--check') {
    if (await fs.readFile(destination, 'utf8') !== result) throw new Error('follow-list source/planner artifact changed');
  } else {
    const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.follow-list-'));
    try { await fs.writeFile(path.join(staging, 'artifact.json'), result); await fs.rename(path.join(staging, 'artifact.json'), destination); }
    finally { await fs.rm(staging, { recursive: true, force: true }); }
  }
  console.log(`${mode === '--check' ? 'Verified' : 'Wrote'} original follow-list read workflow`);
}
