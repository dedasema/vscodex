'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const probeScriptPath = path.resolve(
  __dirname,
  '../../scripts/probe-dynamic-tool.mjs'
);
const FAKE_SERVER_TIMEOUT_MS = 5_000;

const supportModuleUrl = pathToFileURL(
  path.resolve(__dirname, '../../scripts/probeDynamicToolSupport.mjs')
).href;

async function loadSupport() {
  return import(supportModuleUrl);
}

function createFakeAppServerSource() {
  return `
import fs from 'node:fs';
import readline from 'node:readline';

const capturePath = process.argv[2];
const mode = process.env.PROBE_DYNAMIC_TOOL_FAKE_MODE;
const sensitiveNames = [
  'OPENAI_API_KEY',
  'CODEX_API_KEY',
  'CODEX_ACCESS_TOKEN'
];
const normalizedEnvironmentNames = new Set(
  Object.keys(process.env).map((name) => name.toUpperCase())
);
const capture = {
  codeHomeSurvived:
    process.env.CODEX_HOME === 'probe-codex-home-value-not-for-output',
  innocuousEnvironmentSurvived:
    process.env.PROBE_DYNAMIC_TOOL_INNOCUOUS === 'survives',
  sensitiveEnvironmentPresent: Object.fromEntries(
    sensitiveNames.map((name) => [
      name,
      normalizedEnvironmentNames.has(name)
    ])
  ),
  itemToolCallCount: 0,
  receivedExpectedToolResponse: false
};

function saveCapture() {
  fs.writeFileSync(capturePath, JSON.stringify(capture), 'utf8');
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\\n');
}

function completeTurn() {
  send({
    method: 'turn/completed',
    params: { turn: { status: 'completed' } }
  });
}

saveCapture();

let awaitingToolResponse = false;
const input = readline.createInterface({ input: process.stdin });

input.on('line', (line) => {
  const message = JSON.parse(line);

  if (awaitingToolResponse && message.id === 900 && !message.method) {
    capture.receivedExpectedToolResponse =
      message.result?.success === true &&
      message.result?.contentItems?.[0]?.text ===
        'CodexVS dynamic-tool probe executed successfully.';
    awaitingToolResponse = false;
    saveCapture();
    completeTurn();
    return;
  }

  if (message.method === 'initialize') {
    send({ id: message.id, result: {} });
    return;
  }

  if (message.method === 'thread/start') {
    send({ id: message.id, result: { thread: { id: 'fake-thread' } } });
    return;
  }

  if (message.method === 'turn/start') {
    send({ id: message.id, result: {} });

    if (mode === 'call') {
      capture.itemToolCallCount = 1;
      saveCapture();
      awaitingToolResponse = true;
      send({
        id: 900,
        method: 'item/tool/call',
        params: {
          tool: 'vscode_codexvs_probe_tool',
          arguments: { value: 'ping' }
        }
      });
    } else {
      completeTurn();
    }
  }
});

input.on('close', () => process.exit(0));
`;
}

async function createFakeCodex(tempDirectory) {
  const fakeServerPath = path.join(tempDirectory, 'fake-app-server.mjs');
  const launcherName = process.platform === 'win32' ? 'codex.cmd' : 'codex';
  const launcherPath = path.join(tempDirectory, launcherName);

  await fs.writeFile(fakeServerPath, createFakeAppServerSource(), 'utf8');

  if (process.platform === 'win32') {
    await fs.writeFile(
      launcherPath,
      `@echo off
"${process.execPath}" "%~dp0fake-app-server.mjs" "%~dp0child-environment.json"
`,
      'utf8'
    );
  } else {
    await fs.writeFile(
      launcherPath,
      `#!/bin/sh
exec "${process.execPath}" "$(dirname "$0")/fake-app-server.mjs" "$(dirname "$0")/child-environment.json"
`,
      { encoding: 'utf8', mode: 0o755 }
    );
  }
}

function probeEnvironment(tempDirectory, mode) {
  const sensitiveEnvironment =
    process.platform === 'win32'
      ? {
          openai_api_key: 'test-openai-key-mixed-case',
          CoDeX_ApI_KeY: 'test-codex-key-mixed-case',
          CODEX_access_TOKEN: 'test-access-token-mixed-case'
        }
      : {
          OPENAI_API_KEY: 'test-openai-key',
          openai_api_key: 'test-openai-key-mixed-case',
          CODEX_API_KEY: 'test-codex-key',
          CoDeX_ApI_KeY: 'test-codex-key-mixed-case',
          CODEX_ACCESS_TOKEN: 'test-access-token',
          CODEX_access_TOKEN: 'test-access-token-mixed-case'
        };
  const environment = {
    PATH: `${tempDirectory}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ''}`,
    CODEX_HOME: 'probe-codex-home-value-not-for-output',
    PROBE_DYNAMIC_TOOL_INNOCUOUS: 'survives',
    PROBE_DYNAMIC_TOOL_FAKE_MODE: mode,
    ...sensitiveEnvironment
  };

  for (const name of ['ComSpec', 'PATHEXT', 'SystemRoot', 'WINDIR']) {
    if (process.env[name] !== undefined) {
      environment[name] = process.env[name];
    }
  }

  return environment;
}

function runProbe(environment) {
  return new Promise((resolve, reject) => {
    const probe = spawn(process.execPath, [probeScriptPath], {
      cwd: path.resolve(__dirname, '../..'),
      env: environment,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      probe.kill();
    }, FAKE_SERVER_TIMEOUT_MS);

    probe.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    probe.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    probe.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    probe.on('close', (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}

async function runProbeScenario(mode) {
  const tempDirectory = await fs.mkdtemp(
    path.join(os.tmpdir(), 'codexvs-probe-dynamic-tool-')
  );
  const capturePath = path.join(tempDirectory, 'child-environment.json');
  const environment = probeEnvironment(tempDirectory, mode);

  try {
    await createFakeCodex(tempDirectory);
    const result = await runProbe(environment);
    const capture = JSON.parse(await fs.readFile(capturePath, 'utf8'));

    return { capture, result };
  } finally {
    await fs.rm(tempDirectory, { recursive: true, force: true });
  }
}

test('sanitizes credential variables case-insensitively while preserving CODEX_HOME', async () => {
  const { sanitizeProbeChildEnvironment } = await loadSupport();
  const environment = {
    PATH: '/safe/bin',
    CODEX_HOME: '/private/codex-home',
    CUSTOM_SETTING: 'retained',
    openai_api_key: 'removed',
    CoDeX_ApI_KeY: 'removed',
    CODEX_access_TOKEN: 'removed'
  };

  assert.deepEqual(sanitizeProbeChildEnvironment(environment), {
    PATH: '/safe/bin',
    CODEX_HOME: '/private/codex-home',
    CUSTOM_SETTING: 'retained'
  });
});

test('reports a completed turn without a dynamic call as failure', async () => {
  const { reportDynamicToolProbeResult } = await loadSupport();
  const output = [];
  const processRef = { exitCode: 0 };

  reportDynamicToolProbeResult(false, {
    log: (line) => output.push(line),
    processRef
  });

  assert.equal(processRef.exitCode, 1);
  assert.deepEqual(output, [
    '\n=============================',
    'RESULT: FAIL',
    'app-server completed the turn without item/tool/call.',
    '=============================\n'
  ]);
});

test('reports a dynamic call as pass without changing a zero exit status', async () => {
  const { reportDynamicToolProbeResult } = await loadSupport();
  const output = [];
  const processRef = { exitCode: 0 };

  reportDynamicToolProbeResult(true, {
    log: (line) => output.push(line),
    processRef
  });

  assert.equal(processRef.exitCode, 0);
  assert.ok(output.includes('RESULT: PASS'));
});

test('real probe removes sensitive child environment and fails without a tool call', async () => {
  const { capture, result } = await runProbeScenario('complete-without-call');

  assert.equal(result.timedOut, false);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /RESULT: FAIL/);
  assert.equal(
    result.stdout.includes('probe-codex-home-value-not-for-output'),
    false
  );
  assert.equal(
    result.stderr.includes('probe-codex-home-value-not-for-output'),
    false
  );
  assert.equal(capture.codeHomeSurvived, true);
  assert.equal(capture.innocuousEnvironmentSurvived, true);
  assert.deepEqual(capture.sensitiveEnvironmentPresent, {
    OPENAI_API_KEY: false,
    CODEX_API_KEY: false,
    CODEX_ACCESS_TOKEN: false
  });
});

test('real probe passes only after the intended dynamic tool call', async () => {
  const { capture, result } = await runProbeScenario('call');

  assert.equal(result.timedOut, false);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /RESULT: PASS/);
  assert.equal(capture.itemToolCallCount, 1);
  assert.equal(capture.receivedExpectedToolResponse, true);
});
