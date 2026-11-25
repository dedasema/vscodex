import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'codex-provider-discovery-'));
const bundlePath = path.join(temporaryDirectory, 'provider.cjs');
const require = createRequire(import.meta.url);
const originalLoad = Module._load;
const warnings = [];
const errors = [];

class EventEmitter {
  listeners = new Set();
  event = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value) {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
  dispose() {
    this.listeners.clear();
  }
}

class CancellationError extends Error {}

const vscodeStub = {
  CancellationError,
  EventEmitter,
  Disposable: {
    from: (...disposables) => ({ dispose: () => disposables.forEach((value) => value.dispose()) })
  },
  LanguageModelError: {
    NoPermissions: (message) => new Error(message),
    NotFound: (message) => new Error(message),
    Blocked: (message) => new Error(message)
  },
  env: { remoteName: undefined },
  commands: { executeCommand: async () => undefined },
  window: {
    showWarningMessage: async (message) => {
      warnings.push(message);
      return 'Cancel';
    },
    showErrorMessage: async (message) => {
      errors.push(message);
      return undefined;
    }
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key, fallback) => fallback,
      inspect: () => ({ defaultValue: 'codex' })
    }),
    onDidChangeConfiguration: () => ({ dispose() {} })
  },
  LanguageModelTextPart: class {},
  LanguageModelDataPart: class {},
  LanguageModelPromptTsxPart: class {},
  LanguageModelToolCallPart: class {},
  LanguageModelToolResultPart: class {},
  LanguageModelChatToolMode: { Required: 1 }
};

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === 'vscode') {
    return vscodeStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};

try {
  await build({
    stdin: {
      contents: [
        "export * from './src/provider.ts';",
        "export * from './src/appServer/types.ts';"
      ].join('\n'),
      resolveDir: repositoryRoot,
      sourcefile: 'provider-discovery-entry.ts'
    },
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    outfile: bundlePath,
    external: ['vscode']
  });

  const {
    AppServerProtocolError,
    resolveReasoningRequest,
    CodexVSProvider
  } = require(bundlePath);
  const providerLogs = [];
  const output = {
    debug(message, metadata) {
      providerLogs.push({ level: 'debug', message, metadata });
    },
    info(message, metadata) {
      providerLogs.push({ level: 'info', message, metadata });
    }
  };
  const token = { isCancellationRequested: false };
  const backend = createBackend();
  const provider = new CodexVSProvider(output, backend);

  assert.deepEqual(await provider.provideLanguageModelChatInformation({ silent: false }, token), []);
  assert.equal(backend.accountReads, 1);
  assert.deepEqual(warnings, [], 'A signed-in account with an empty filtered catalog must not be prompted to sign in.');

  backend.listModels = async () => {
    throw new AppServerProtocolError('Malformed catalog page.');
  };
  assert.deepEqual(await provider.provideLanguageModelChatInformation({ silent: false }, token), []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /model discovery/i);
  assert.match(errors[0], /Codex CLI unknown/);
  assert.match(errors[0], /update Codex CLI/i);
  assert.doesNotMatch(errors[0], /app-server is unavailable/i);

  const responseBackend = createBackend();
  responseBackend.listModels = async () => [{
    id: 'gpt-ultra-entry',
    model: 'gpt-5.5',
    displayName: 'GPT Ultra',
    description: 'Provider response test model.',
    hidden: false,
    isDefault: true,
    supportedReasoningEfforts: [
      { effort: 'max', description: 'Maximum.' },
      { effort: 'ultra', description: 'Maximum with delegation.' }
    ],
    defaultReasoningEffort: 'max',
    inputModalities: ['text'],
    serviceTiers: [],
    contextWindow: 272_000,
    catalogHash: 'provider-response-catalog'
  }];
  let capturedRequest;
  responseBackend.runChat = async (request) => {
    capturedRequest = request;
    return { kind: 'completed' };
  };
  const responseProvider = new CodexVSProvider(output, responseBackend);
  const responseModels = await responseProvider.provideLanguageModelChatInformation(
    { silent: false },
    token
  );
  await responseProvider.provideLanguageModelChatResponse(
    responseModels[0],
    [],
    {
      modelConfiguration: { reasoningEffort: 'ultra' },
      tools: [{
        name: 'runSubagent',
        description: 'Run a native VS Code subagent.',
        inputSchema: { type: 'object' }
      }]
    },
    { report() {} },
    token
  );
  assert.equal(capturedRequest.requestedMode, 'ultra');
  assert.equal(capturedRequest.backendEffort, 'max');
  assert.equal(capturedRequest.orchestrationMode, 'vscodeProactive');
  assert.equal(capturedRequest.vsCodeSubagentToolName, 'runSubagent');
  const requestShapeLog = providerLogs.find((entry) =>
    entry.message === 'language model request shape');
  assert.deepEqual({
    requestedMode: requestShapeLog.metadata.requestedMode,
    backendEffort: requestShapeLog.metadata.backendEffort,
    orchestrationMode: requestShapeLog.metadata.orchestrationMode,
    vsCodeDelegationAvailable: requestShapeLog.metadata.vsCodeDelegationAvailable
  }, {
    requestedMode: 'ultra',
    backendEffort: 'max',
    orchestrationMode: 'vscodeProactive',
    vsCodeDelegationAvailable: true
  });
  assert.equal(
    JSON.stringify(requestShapeLog).includes('runSubagent'),
    false,
    'Request diagnostics must not log the native tool name.'
  );
  responseProvider.dispose();

  const work = createBackend();
  work.listModels = responseBackend.listModels;
  const calls = [];
  let failWork = false;
  work.runChat = async () => {
    calls.push('work');
    if (failWork) throw new Error('Work account exhausted');
    return { kind: 'completed' };
  };
  responseBackend.runChat = async () => { calls.push('legacy'); return { kind: 'completed' }; };
  const usageModels = [];
  const multi = new CodexVSProvider(output, responseBackend, {
    observeRequestedModel: (backend, label, id) => usageModels.push([backend, label, id])
  }, undefined, {
    list: () => [{ id: 'work', label: 'Work' }],
    get: (id) => id === 'work' ? work : undefined
  });
  const [legacy, named] = await multi.provideLanguageModelChatInformation({ silent: true }, token);
  assert.equal(legacy.id, responseModels[0].id);
  assert.equal(named.name, 'GPT Ultra · Work');
  const send = (model) => multi.provideLanguageModelChatResponse(model, [], {}, { report() {} }, token);
  await send(named);
  assert.deepEqual(usageModels, [[work, 'Work', 'gpt-5.5']]);
  await send(legacy);
  assert.deepEqual(usageModels.at(-1), [responseBackend, 'Default account', 'gpt-5.5']);
  failWork = true;
  await assert.rejects(send(named));
  await assert.rejects(send({ ...named, id: 'codex-account::unknown::gpt-ultra-entry' }));
  await assert.rejects(send({ ...named, id: 'codex-account::work::gpt-5.5' }));
  assert.deepEqual(calls, ['work', 'legacy', 'work']);
  failWork = false;
  responseBackend.listModels = async () => { throw new Error('Default account unavailable'); };
  assert.deepEqual(await multi.provideLanguageModelChatInformation({ silent: false }, token), [named]);
  await send(named);
  assert.deepEqual(calls, ['work', 'legacy', 'work', 'work']);
  const workModels = await work.listModels();
  let resolveOlder;
  work.listModels = () => new Promise((resolve) => { resolveOlder = resolve; });
  responseBackend.listModels = async () => workModels;
  const older = send(named);
  await send(legacy);
  const afterNewer = usageModels.length;
  assert.deepEqual(usageModels.at(-1), [responseBackend, 'Default account', 'gpt-5.5']);
  resolveOlder(workModels);
  await older;
  assert.equal(usageModels.length, afterNewer, 'An older request cannot retake the limits display.');
  assert.deepEqual(calls.slice(-2), ['legacy', 'work'], 'Both chats retain their own routing.');
  multi.dispose();

  const selected = {
    reasoningEffort: 'max',
    supportedReasoningEfforts: ['low', 'high', 'max', 'ultra', 'future-mode']
  };
  assert.deepEqual(resolveReasoningRequest(
    selected,
    {
      modelConfiguration: { reasoningEffort: 'high' },
      modelOptions: { reasoningEffort: 'ultra' }
    },
    'low',
    [{ name: 'runSubagent' }]
  ), {
    requestedMode: 'ultra',
    backendEffort: 'max',
    orchestrationMode: 'vscodeProactive',
    vsCodeSubagentToolName: 'runSubagent'
  }, 'Caller modelOptions take precedence over the VS Code model-configuration default.');
  assert.deepEqual(resolveReasoningRequest(
    selected,
    { modelConfiguration: { reasoningEffort: 'ultra' } },
    'low',
    []
  ), {
    requestedMode: 'ultra',
    backendEffort: 'max',
    orchestrationMode: 'standard',
    vsCodeSubagentToolName: undefined
  }, 'Ultra falls back to single-agent Max when nested subagents are unavailable.');
  assert.deepEqual(resolveReasoningRequest(
    selected,
    { modelConfiguration: { reasoningEffort: 'ultra' } },
    'low',
    [{ name: 'agent/runSubagent' }]
  ), {
    requestedMode: 'ultra',
    backendEffort: 'max',
    orchestrationMode: 'vscodeProactive',
    vsCodeSubagentToolName: 'agent/runSubagent'
  }, 'The namespaced native VS Code subagent tool is detected exactly.');
  assert.deepEqual(resolveReasoningRequest(
    selected,
    { modelConfiguration: { reasoningEffort: 'max' } },
    'low',
    []
  ), {
    requestedMode: 'max',
    backendEffort: 'max',
    orchestrationMode: 'standard',
    vsCodeSubagentToolName: undefined
  }, 'Max stays usable without subagents.');
  assert.equal(
    resolveReasoningRequest(
      selected,
      { modelConfiguration: { reasoningEffort: 'unsupported' } },
      'future-mode',
      []
    ).requestedMode,
    'future-mode',
    'An unsupported per-chat value falls back to a catalog-supported global setting.'
  );

  provider.dispose();
  console.log('Provider discovery behavior tests passed.');
} finally {
  Module._load = originalLoad;
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function createBackend() {
  return {
    processGeneration: 1,
    accountGeneration: 1,
    runtimeVersion: '0.144.4',
    accountReads: 0,
    onDidChangeAccount: () => ({ dispose() {} }),
    onDidChangeModels: () => ({ dispose() {} }),
    async listModels() {
      return [];
    },
    async readAccount() {
      this.accountReads += 1;
      return { type: 'chatgpt', planType: 'pro' };
    }
  };
}
