const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { buildSync } = require('esbuild');
const result = buildSync({ entryPoints: ['src/accounts.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
const loaded = new Module('accounts');
loaded._compile(result.outputFiles[0].text, 'accounts.cjs');
const { NamedAccountRegistry } = loaded.exports;

function store(initial) {
  let value = initial;
  return { get: () => value, update: async (_key, next) => { value = next; }, value: () => value };
}

test('adds serially, rejects invalid labels, and lazily disposes one backend per account', async () => {
  const state = store();
  let created = 0, disposed = 0;
  const registry = new NamedAccountRegistry(state, () => { created++; return { dispose() { disposed++; } }; });
  const [a, b] = await Promise.all([registry.add(' Work '), registry.add('Personal')]);
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.equal(a.label, 'Work');
  assert.notEqual(a.id, b.id);
  await assert.rejects(registry.add(' '));
  await assert.rejects(registry.add('Work'));
  assert.deepEqual(state.value(), [a, b]);
  assert.equal(registry.get('missing'), undefined);
  assert.equal(created, 0);
  assert.equal(registry.get(a.id), registry.get(a.id));
  assert.equal(created, 1);
  registry.dispose();
  registry.dispose();
  assert.equal(disposed, 1);
});

test('validates persisted records and strips extra fields', () => {
  for (const value of [null, {}, [{ id: '../bad', label: 'x' }], [{ id: 'con', label: 'x' }], [{ id: 'same', label: 'x' }, { id: 'same', label: 'y' }], [{ id: 'ok', label: ' ' }]]) {
    assert.throws(() => new NamedAccountRegistry(store(value), () => ({ dispose() {} })));
  }
  const registry = new NamedAccountRegistry(store([{ id: 'valid-id', label: 'Work', extra: 'ignored' }]), () => ({ dispose() {} }));
  assert.deepEqual(registry.list(), [{ id: 'valid-id', label: 'Work' }]);
});

test('failed persistence leaves accounts unchanged and subsequent adds work', async () => {
  let fail = true;
  const state = { get: () => undefined, update: async () => { if (fail) { fail = false; throw Error('failure'); } } };
  const registry = new NamedAccountRegistry(state, () => ({ dispose() {} }));
  await assert.rejects(registry.add('Work'));
  assert.deepEqual(registry.list(), []);
  assert.equal((await registry.add('Work')).label, 'Work');
});
