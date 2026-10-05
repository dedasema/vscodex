import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadTypeScript } = require('./fixtures/accountUsagePanelHarness.cjs');
const panels = [];
const configuration = eventSource();
const item = {
  visible: false, text: '', tooltip: '',
  show() { this.visible = true; }, hide() { this.visible = false; },
  dispose() { this.visible = false; }
};
const vscode = {
  StatusBarAlignment: { Right: 2 }, ViewColumn: { Beside: -2 },
  Disposable: { from: (...values) => ({ dispose: () => values.forEach((value) => value.dispose()) }) },
  window: {
    createStatusBarItem: () => item,
    showInformationMessage: async () => { throw new Error('Dashboard must replace the notification.'); },
    createWebviewPanel: (...args) => {
      const incoming = eventSource(), closed = eventSource(), visibility = eventSource();
      const panel = {
        args, messages: [], reveals: 0,
        webview: { html: '', onDidReceiveMessage: incoming.event,
          postMessage: (message) => { panel.messages.push(message); return Promise.resolve(true); } },
        onDidDispose: closed.event, onDidChangeViewState: visibility.event,
        reveal: () => { panel.reveals += 1; },
        dispose: () => closed.fire(), receive: incoming.fire,
        listeners: () => incoming.size() + closed.size() + visibility.size()
      };
      panels.push(panel);
      return panel;
    }
  },
  workspace: {
    getConfiguration: () => ({ get: (_key, fallback) => fallback, inspect: () => ({ defaultValue: 'codex' }) }),
    onDidChangeConfiguration: configuration.event
  }
};
const { CodexAccountUsageStatusBar } = loadTypeScript('src/accountUsageStatusBar.ts', vscode);
const rates = eventSource(), accounts = eventSource();
const pending = [];
let activityReads = 0;
const source = {
  onDidUpdateRateLimits: rates.event, onDidChangeAccount: accounts.event,
  readRateLimits: () => new Promise((resolve, reject) => pending.push({ resolve, reject })),
  readTokenActivity: async () => { activityReads += 1; }
};
const status = new CodexAccountUsageStatusBar({ debug() {}, warn() {} }, source);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const html = (panel = panels.at(-1)) => panel.messages.filter((message) => message.type === 'render').at(-1)?.html ?? '';
const snapshot = (planType = 'pro') => ({ fetchedAt: Date.now(), planType, limits: [
  { limitId: 'codex', windowMinutes: 300, usedPercent: 25, remainingPercent: 75 }
] });

try {
  const first = status.showDetails();
  assert.equal(panels.length, 1, 'Opening details must create the dashboard immediately.');
  panels[0].receive({ type: 'ready' });
  assert.match(html(), /Refreshing account limits/);
  const repeated = status.showDetails();
  const concurrent = status.refresh();
  assert.equal(panels.length, 1);
  assert.equal(pending.length, 1, 'Command and refresh must coalesce.');
  pending[0].resolve(snapshot());
  await Promise.all([first, repeated, concurrent]);
  assert.match(html(), /Account limits are current/);
  assert.equal(item.visible, true);
  assert.equal(activityReads, 0);

  panels[0].receive({ type: 'refresh', extra: true });
  assert.equal(pending.length, 1);
  panels[0].receive({ type: 'refresh' });
  pending[1].reject(new Error('private RPC identity'));
  await tick();
  assert.match(html(), /Could not refresh account limits/);
  assert.match(html(), /pro/);
  assert.doesNotMatch(html(), /private RPC identity/);

  rates.fire(snapshot('Live plan'));
  assert.match(html(), /Live plan/);
  rates.fire({ fetchedAt: Date.now() - 3600000, limits: snapshot().limits });
  assert.match(html(), /Showing older account limits/);
  rates.fire({ fetchedAt: Date.now(), limits: [
    { limitName: 'model-a', windowMinutes: 10080, usedPercent: 10, remainingPercent: 90 },
    { limitName: 'model-b', windowMinutes: 10080, usedPercent: 80, remainingPercent: 20 }
  ] });
  status.setSelectedModel('model-b');
  assert.match(item.text, /20% left/);
  assert.match(html(), /model-b/);

  panels[0].receive({ type: 'refresh' });
  accounts.fire();
  assert.equal(item.visible, false);
  assert.doesNotMatch(html(), /model-b/);
  pending[2].resolve(snapshot('Old account'));
  await tick();
  assert.doesNotMatch(html(), /Old account/);
  assert.match(html(), /No account limit data/);

  const empty = status.showDetails();
  pending[3].resolve({ fetchedAt: Date.now(), limits: [] });
  await empty;
  assert.match(html(), /No account limit data/);
  assert.equal(item.visible, false);
  panels[0].receive({ type: 'refresh' });
  pending[4].reject(new Error('private empty error'));
  await tick();
  assert.match(html(), /Could not refresh account limits/);
  assert.doesNotMatch(html(), /private empty error/);

  panels[0].receive({ type: 'refresh' });
  panels[0].dispose();
  assert.equal(panels[0].listeners(), 0);
  const reopened = status.showDetails();
  panels[1].receive({ type: 'ready' });
  assert.match(html(), /Refreshing account limits/);
  assert.equal(pending.length, 6);
  pending[5].resolve(snapshot('Reopened'));
  await reopened;
  await tick();
  assert.match(html(), /Reopened/);

  const old = status.refresh();
  accounts.fire();
  const current = status.refresh();
  assert.equal(pending.length, 8, 'A new account must not reuse an old account request.');
  pending[7].resolve(snapshot('Current account'));
  await current;
  pending[6].reject(new Error('late old error'));
  await old;
  assert.match(html(), /Current account/);
  assert.doesNotMatch(html(), /Could not refresh/);

  accounts.fire();
  const failure = status.refresh();
  pending[8].reject(new Error('raw no-account failure'));
  await assert.rejects(failure, /^Error: Could not refresh account limits\.$/);
  assert.match(html(), /Could not refresh account limits/);
  assert.doesNotMatch(html(), /Current account|raw no-account failure/);

  const disposed = status.refresh();
  status.dispose();
  pending[9].resolve(snapshot('After dispose'));
  await disposed;
  rates.fire(snapshot('Disposed live event'));
  assert.equal(item.visible, false);
  assert.equal(rates.size() + accounts.size() + configuration.size() + panels[1].listeners(), 0);
  await status.showDetails();
  assert.equal(panels.length, 2);
  for (const oldRejects of [false, true]) {
    for (const currentFirst of [false, true]) {
      for (const currentFails of [false, true]) {
        await checkAccountRefreshRace({ oldRejects, currentFirst, currentFails });
      }
    }
  }
  console.log('Account usage dashboard integration tests passed.');
} finally {
  status.dispose();
}

async function checkAccountRefreshRace({ oldRejects, currentFirst, currentFails }) {
  const changes = eventSource();
  const reads = [];
  const dashboard = new CodexAccountUsageStatusBar({ debug() {}, warn() {} }, {
    onDidUpdateRateLimits: eventSource().event,
    onDidChangeAccount: changes.event,
    readRateLimits: () => new Promise((resolve, reject) => reads.push({ resolve, reject }))
  });
  try {
    const opened = dashboard.showDetails();
    const panel = panels.at(-1);
    panel.receive({ type: 'ready' });
    reads[0].resolve(snapshot('Account A'));
    await opened;
    panel.receive({ type: 'refresh' });
    changes.fire();
    const current = dashboard.refresh().then(() => undefined, (error) => error);
    const busy = () => panel.messages.filter((message) => message.type === 'busy').at(-1)?.busy;
    assert.equal(reads.length, 3, 'Account B needs its own deferred read.');
    assert.match(html(panel), /Refreshing account limits/);
    assert.equal(busy(), true);
    const sinceChange = panel.messages.length;
    const finishCurrent = async () => {
      if (currentFails) reads[2].reject(new Error('private account B RPC error'));
      else reads[2].resolve(snapshot('Account B'));
      const result = await current;
      if (currentFails) assert.equal(result.message, 'Could not refresh account limits.');
      else assert.equal(result, undefined);
    };
    if (currentFirst) await finishCurrent();
    if (oldRejects) reads[1].reject(new Error('private obsolete account A RPC error'));
    else reads[1].resolve(snapshot('Obsolete account A'));
    await tick();
    if (!currentFirst) {
      assert.match(html(panel), /Refreshing account limits/,
        'Obsolete panel refresh A must not promote pending account B to ready.');
      assert.equal(busy(), true, 'The panel must stay busy until account B completes.');
      await finishCurrent();
      await tick();
    }
    if (currentFails) {
      assert.match(html(panel), /Could not refresh account limits/);
      assert.doesNotMatch(html(panel), /Account B/);
    } else {
      assert.match(html(panel), /Account limits are current/);
      assert.match(html(panel), /Account B/);
    }
    assert.equal(busy(), false);
    assert.doesNotMatch(JSON.stringify(panel.messages.slice(sinceChange)), /Account A|private|RPC error/);
  } finally {
    dashboard.dispose();
  }
}

function eventSource() {
  const listeners = new Set();
  return {
    event: (listener) => { listeners.add(listener); return { dispose: () => listeners.delete(listener) }; },
    fire: (value) => { for (const listener of [...listeners]) listener(value); },
    size: () => listeners.size
  };
}
