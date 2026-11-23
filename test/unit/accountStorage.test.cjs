'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSync } = require('esbuild');
const Module = require('node:module');

test('account storage roots are isolated and invalid identifiers have no side effects', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-account-test-'));
  try {
    const result = buildSync({ entryPoints: ['src/appServer/accountStorage.ts'], bundle: true, platform: 'node', format: 'cjs', write: false });
    const loaded = new Module('accountStorage');
    loaded._compile(result.outputFiles[0].text, 'accountStorage.cjs');
    const { accountStorageDirectory } = loaded.exports;
    assert.equal(accountStorageDirectory(root), root);
    assert.equal(accountStorageDirectory(root, 'alpha'), path.join(root, 'accounts', 'alpha'));
    assert.notEqual(accountStorageDirectory(root, 'alpha'), accountStorageDirectory(root, 'beta-2'));
    for (const id of ['', '../escape', 'A', 'a/b', 'a\b', '.', 'a\n', 'con', '-a', 'a-']) {
      assert.throws(() => accountStorageDirectory(root, id), TypeError, id);
    }
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
