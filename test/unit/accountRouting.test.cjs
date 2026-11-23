const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { buildSync } = require('esbuild');

const result = buildSync({ entryPoints: ['src/accountRouting.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const loaded = new Module('accountRouting');
loaded._compile(result.outputFiles[0].text, 'accountRouting.cjs');
const { parseAccountRoute, qualifyAccountModel, findAccountModel } = loaded.exports;

test('legacy IDs remain default and named models use distinct opaque IDs', () => {
  const model = { catalogId: 'same::catalog', info: { id: 'codex::same::catalog', name: 'Codex' } };
  assert.deepEqual(parseAccountRoute(model.info.id), { kind: 'legacy' });
  const first = qualifyAccountModel(model, { id: 'alpha', label: 'Work' });
  const second = qualifyAccountModel(model, { id: 'beta', label: 'Personal' });
  assert.notEqual(first.info.id, second.info.id);
  assert.equal(first.info.name, 'Codex · Work');
  assert.equal(model.info.name, 'Codex');
  assert.deepEqual(parseAccountRoute(first.info.id), { kind: 'named', accountId: 'alpha', catalogId: model.catalogId });
  assert.equal(findAccountModel(first.info.id, [second, first]), first);
});

test('malformed and unknown named IDs cannot fall back to a default or another account', () => {
  assert.deepEqual(parseAccountRoute('codex-account::../escape::target'), { kind: 'invalid' });
  assert.deepEqual(parseAccountRoute('codex-account::alpha::'), { kind: 'invalid' });
  const model = { catalogId: 'target', info: { id: 'codex::target', name: 'Codex' } };
  const named = qualifyAccountModel(model, { id: 'alpha', label: 'Work' });
  assert.equal(findAccountModel('codex-account::unknown::target', [model, named]), undefined);
  assert.equal(findAccountModel('codex-account::alpha::unknown', [model, named]), undefined);
});
