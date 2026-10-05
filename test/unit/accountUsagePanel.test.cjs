'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { loadTypeScript } = require('../fixtures/accountUsagePanelHarness.cjs');

let activeHarness;
const vscodeStub = {
  ViewColumn: { Beside: -2 },
  window: { createWebviewPanel: (...args) => activeHarness.createPanel(...args) }
};
const panelApi = loadTypeScript('src/accountUsagePanel.ts', vscodeStub);

function makeHarness() {
  const panels = [];
  const harness = {
    panels,
    createPanel(...args) {
      const panel = makeWebviewPanel(args);
      panels.push(panel);
      return panel;
    }
  };
  activeHarness = harness;
  return harness;
}

function makeWebviewPanel(args) {
  const incoming = makeEvent();
  const disposed = makeEvent();
  const visibility = makeEvent();
  const messages = [];
  const panel = {
    args,
    messages,
    revealCalls: [],
    webview: {
      options: args[3],
      html: '',
      onDidReceiveMessage: (handler) => incoming.subscribe(handler),
      postMessage: (message) => {
        messages.push(message);
        return Promise.resolve(true);
      }
    },
    onDidDispose: (handler) => disposed.subscribe(handler),
    onDidChangeViewState: (handler) => visibility.subscribe(handler),
    reveal: (...revealArgs) => panel.revealCalls.push(revealArgs),
    setVisible: (visible) => visibility.fire({ webviewPanel: { visible } }),
    dispose: () => disposed.fire(),
    receive: (message) => incoming.fire(message),
    listenerDisposeCount: () => incoming.disposeCount + disposed.disposeCount + visibility.disposeCount
  };
  return panel;
}

function makeEvent() {
  let handler;
  const event = {
    disposeCount: 0,
    subscribe(callback) {
      handler = callback;
      return { dispose: () => { event.disposeCount += 1; handler = undefined; } };
    },
    fire(value) {
      return handler?.(value);
    }
  };
  return event;
}

function createPanel(callback = () => {}, clock = () => Date.parse('2025-06-10T12:15:00Z')) {
  const harness = makeHarness();
  return { harness, instance: new panelApi.CodexAccountUsagePanel(callback, clock) };
}

function makeView(overrides = {}) {
  return {
    primaryWindows: [{ kind: '5h', label: '5h', windowMinutes: 300, usedPercent: 25, remainingPercent: 75 }],
    otherWindows: [],
    planType: 'Pro',
    creditsBalance: 2.5,
    fetchedAt: Date.parse('2025-06-10T12:00:00Z'),
    freshness: 'fresh',
    isStale: false,
    ...overrides
  };
}

function lastRender(panel) {
  return panel.messages.filter((message) => message.type === 'render').at(-1)?.html ?? '';
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test('reuses one beside panel, disposes listeners, and recreates after close', async () => {
  const { harness, instance } = createPanel();
  instance.show();
  const first = harness.panels[0];
  instance.show();
  assert.equal(harness.panels.length, 1);
  assert.deepEqual(first.args.slice(0, 3), ['codexvs.accountLimits', 'Codex Account Limits', -2]);
  assert.deepEqual(first.webview.options, { enableScripts: true, localResourceRoots: [] });
  assert.deepEqual(first.revealCalls, [[-2, false]]);

  first.dispose();
  assert.equal(first.listenerDisposeCount(), 3);
  instance.update(makeView({ planType: 'Latest after close' }), 'stale');
  instance.show();
  assert.equal(harness.panels.length, 2);
  const second = harness.panels[1];
  second.receive({ type: 'ready' });
  await nextTurn();
  assert.match(lastRender(second), /Latest after close/);
  assert.match(lastRender(second), /Showing older account limits/);
  instance.dispose();
  assert.equal(second.listenerDisposeCount(), 3);
});

test('strict ready handshakes replay latest state on reload and never invoke refresh', async () => {
  let calls = 0;
  const resolvers = [];
  const { harness, instance } = createPanel(() => {
    calls += 1;
    return new Promise((resolve) => resolvers.push(resolve));
  });
  instance.update(makeView({ planType: 'Before initial load' }), 'stale');
  instance.show();
  const panel = harness.panels[0];
  panel.receive({ type: 'ready', command: 'refresh' });
  panel.receive({ type: 'unknown' });
  assert.equal(panel.messages.length, 0);

  panel.receive({ type: 'ready' });
  await nextTurn();
  assert.equal(panel.messages.filter((message) => message.type === 'render').length, 1);
  assert.match(lastRender(panel), /Before initial load/);
  assert.match(lastRender(panel), /Showing older account limits/);
  assert.equal(calls, 0);

  instance.update(makeView({ planType: 'Latest after reload' }), 'loading');
  panel.receive({ type: 'ready' });
  await nextTurn();
  assert.match(lastRender(panel), /Latest after reload/);
  assert.match(lastRender(panel), /Refreshing account limits/);
  assert.equal(calls, 0);

  const renderedBeforeHide = panel.messages.filter((message) => message.type === 'render').length;
  panel.setVisible(false);
  instance.update(makeView({ planType: 'Latest while hidden' }), 'stale');
  assert.equal(panel.messages.filter((message) => message.type === 'render').length, renderedBeforeHide);
  panel.setVisible(true);
  await nextTurn();
  assert.match(lastRender(panel), /Latest while hidden/);
  assert.match(lastRender(panel), /Showing older account limits/);
  assert.equal(calls, 0);

  panel.receive({ type: 'refresh' });
  assert.equal(calls, 1);
  panel.dispose();
  panel.receive({ type: 'refresh' });
  instance.show();
  const recreated = harness.panels[1];
  recreated.receive({ type: 'ready' });
  await nextTurn();
  assert.match(lastRender(recreated), /Refreshing account limits/);
  assert.ok(recreated.messages.some((message) => message.type === 'busy' && message.busy));
  resolvers[0]();
  await nextTurn();
  assert.match(lastRender(recreated), /Account limits are current/);
  assert.deepEqual(recreated.messages.filter((message) => message.type === 'busy').at(-1), { type: 'busy', busy: false });
  assert.equal(calls, 1);
  instance.dispose();
});

test('rejects malformed messages and preserves latest data with generic refresh failure', async () => {
  let calls = 0;
  let instance;
  const latest = makeView({ planType: 'Latest good data' });
  let rejectRefresh;
  ({ instance } = createPanel(() => {
    calls += 1;
    instance.update(latest, 'ready');
    return new Promise((resolve, reject) => { rejectRefresh = reject; });
  }));
  instance.update(makeView({ planType: 'Old data' }), 'ready');
  instance.show();
  const panel = activeHarness.panels[0];
  panel.receive({ type: 'ready' });
  await nextTurn();
  for (const message of [null, [], {}, { type: 'refresh', command: 'execute' }, { type: 'ready', extra: true }, { type: 'other' }]) {
    panel.receive(message);
  }
  await nextTurn();
  assert.equal(calls, 0);

  panel.receive({ type: 'refresh' });
  assert.equal(calls, 1);
  panel.dispose();
  panel.receive({ type: 'refresh' });
  instance.show();
  const recreated = activeHarness.panels[1];
  recreated.receive({ type: 'ready' });
  await nextTurn();
  rejectRefresh(new Error('private raw failure'));
  await nextTurn();
  const rendered = lastRender(recreated);
  assert.match(rendered, /Latest good data/);
  assert.match(rendered, /Could not refresh account limits/);
  assert.doesNotMatch(rendered, /private raw failure/);
  assert.deepEqual(recreated.messages.filter((message) => message.type === 'busy').at(-1), { type: 'busy', busy: false });
  instance.dispose();
});

test('sets loading and disables refresh while busy, then releases it without floods', async () => {
  let calls = 0;
  const resolvers = [];
  const { harness, instance } = createPanel(() => {
    calls += 1;
    return new Promise((resolve) => resolvers.push(resolve));
  });
  instance.show();
  const panel = harness.panels[0];
  panel.receive({ type: 'ready' });
  await nextTurn();
  panel.receive({ type: 'refresh' });
  panel.receive({ type: 'refresh' });
  assert.equal(calls, 1);
  assert.match(lastRender(panel), /Refreshing account limits/);
  assert.ok(panel.messages.some((message) => message.type === 'busy' && message.busy));

  resolvers[0]();
  await nextTurn();
  assert.ok(panel.messages.some((message) => message.type === 'busy' && !message.busy));
  panel.receive({ type: 'refresh' });
  assert.equal(calls, 2);
  resolvers[1]();
  await nextTurn();
  instance.dispose();
});
