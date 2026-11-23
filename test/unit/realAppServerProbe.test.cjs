const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { test } = require('node:test');

const probe = path.resolve(__dirname, '../realAppServerProbe.mjs');

test('the real probe requires explicit use of its dedicated login', () => {
  const result = spawnSync(process.execPath, [probe], {
    env: {
      ...process.env,
      CODEX_TEST_USE_DEDICATED_HOME: '',
      CODEX_TEST_CODEX_COMMAND: 'codexvs-test-nonexistent-executable'
    },
    encoding: 'utf8',
    timeout: 10000
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Set CODEX_TEST_USE_DEDICATED_HOME=1 to use the dedicated CodexVS probe login.\n');
});
