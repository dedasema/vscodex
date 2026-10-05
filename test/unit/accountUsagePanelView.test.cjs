'use strict';

const assert = require('node:assert/strict');
const vm = require('node:vm');
const test = require('node:test');
const { loadTypeScript } = require('../fixtures/accountUsagePanelHarness.cjs');

const view = loadTypeScript('src/accountUsagePanelView.ts');
const now = Date.parse('2025-06-10T12:04:00Z');

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

function runPanelScript(html) {
  const source = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(source, 'panel script should exist');
  const sentMessages = [];
  let onMessage;
  const document = { body: {}, activeElement: undefined };
  const content = { innerHTML: '' };
  const refresh = {
    addEventListener(type, callback) { if (type === 'click') this.onClick = callback; },
    focus() { document.activeElement = this; }
  };
  Object.defineProperty(refresh, 'disabled', {
    get() { return this.isDisabled; },
    set(value) {
      this.isDisabled = value;
      if (value && document.activeElement === this) document.activeElement = document.body;
    }
  });
  refresh.disabled = /<button id="refresh" type="button" disabled>/.test(html);
  document.getElementById = (id) => id === 'content' ? content : refresh;
  const window = { addEventListener(type, callback) { if (type === 'message') onMessage = callback; } };
  const api = { postMessage: (message) => { sentMessages.push(message); return Promise.resolve(true); } };
  vm.runInNewContext(source, { document, window, acquireVsCodeApi: () => api });
  return {
    content, document, refresh, sentMessages,
    sendHostMessage(message) { onMessage?.({ data: message }); },
    clickRefresh() { refresh.onClick?.(); }
  };
}

test('uses nonce-only isolation and escapes adversarial plan, window, and reset strings', () => {
  const hostile = `Plan <img src=x onerror="boom()"> & 'quoted'`;
  const html = view.renderAccountUsagePanelHtml('c3VpdGUtbm9uY2U=', makeView({
    planType: hostile,
    primaryWindows: [{
      kind: '5h', label: hostile, limitName: hostile, windowMinutes: 300,
      usedPercent: 25, remainingPercent: 75,
      resetAtLabel: hostile, resetRelativeLabel: hostile
    }]
  }), 'ready', false, now);
  const encoded = 'Plan &lt;img src=x onerror=&quot;boom()&quot;&gt; &amp; &#39;quoted&#39;';

  assert.match(html, /default-src 'none'/);
  assert.match(html, /img-src 'none'/);
  assert.match(html, /connect-src 'none'/);
  assert.ok(html.includes('<style nonce="c3VpdGUtbm9uY2U=">'));
  assert.ok(html.includes('<script nonce="c3VpdGUtbm9uY2U=">'));
  assert.equal(html.split(encoded).length - 1, 7);
  assert.doesNotMatch(html, /<img src=x/);
});

test('renders actual windows, bounded progress, window-aware labels, and honest empty data', () => {
  const html = view.renderAccountUsageDashboardHtml(makeView({
    primaryWindows: [
      { kind: '5h', label: '5-hour', limitName: 'Codex', windowMinutes: 300, usedPercent: 125, remainingPercent: -25 },
      { kind: 'weekly', label: 'Weekly', windowMinutes: 10080, usedPercent: 50, remainingPercent: 50 }
    ],
    otherWindows: [{ kind: 'daily', label: 'Daily', windowMinutes: 1440, usedPercent: 10, remainingPercent: 90 }]
  }), 'ready', now);

  assert.match(html, /5-hour/);
  assert.match(html, /Weekly/);
  assert.match(html, /Other windows/);
  assert.match(html, /Daily/);
  assert.match(html, /max="100" value="100"/);
  assert.match(html, /100% used/);
  assert.match(html, /0% remaining/);
  assert.match(html, /aria-label="5-hour \(Codex\): 100% used, 0% remaining"/);

  const empty = view.renderAccountUsageDashboardHtml(makeView({
    primaryWindows: [], otherWindows: [], planType: undefined, creditsBalance: undefined
  }), 'empty', now);
  assert.match(empty, /No account limit windows were returned/);
  assert.doesNotMatch(empty, /<progress/);
  assert.doesNotMatch(empty, /Plan:/);
  assert.doesNotMatch(empty, /Credits balance:/);
});

test('shows absolute fetched time and age, and never calls an unknown timestamp current', () => {
  const fresh = view.renderAccountUsageDashboardHtml(makeView(), 'ready', now);
  assert.ok(fresh.includes(`Fetched ${new Date(makeView().fetchedAt).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short'
  })}`));
  assert.match(fresh, /4 minutes ago/);
  assert.match(fresh, /Data freshness: Fresh/);

  const stale = view.renderAccountUsageDashboardHtml(makeView(), 'ready', Date.parse('2025-06-10T12:20:00Z'));
  assert.match(stale, /20 minutes ago/);
  assert.match(stale, /Data freshness: Stale/);

  const unknown = view.renderAccountUsageDashboardHtml(makeView({ fetchedAt: Number.NaN }), 'ready', now);
  assert.match(unknown, /Fetch time unknown/);
  assert.match(unknown, /Data freshness: Unknown/);
  assert.doesNotMatch(unknown, /Account limits are current/);
});

test('renders local fetched times for known and unavailable ages in non-UTC host zones', () => {
  const previousZone = process.env.TZ;
  const fetchedAt = Date.parse('2026-10-04T21:22:49.733Z');
  try {
    for (const [zone, hour, day] of [['America/Los_Angeles', 14, 4], ['Asia/Kolkata', 2, 5]]) {
      process.env.TZ = zone;
      assert.equal(new Date(fetchedAt).getHours(), hour);
      assert.equal(new Date(fetchedAt).getDate(), day);
      const model = makeView({ fetchedAt });
      const expected = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: zone
      }).format(fetchedAt);
      const fresh = view.renderAccountUsageDashboardHtml(model, 'ready', fetchedAt + 4 * 60_000);
      assert.ok(fresh.includes(`Fetched ${expected} (4 minutes ago).`));
      assert.match(fresh, /Data freshness: Fresh/);
      const unavailable = view.renderAccountUsageDashboardHtml(model, 'ready', fetchedAt - 1);
      assert.ok(unavailable.includes(`Fetched ${expected}; age unavailable.`));
      assert.match(unavailable, /Data freshness: Unknown/);
      assert.equal(model.fetchedAt, fetchedAt);
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('inline UI announces ready, sends only refresh, and restores focus when busy ends', () => {
  const script = runPanelScript(view.renderAccountUsagePanelHtml('c3VpdGUtbm9uY2U=', undefined, 'loading', false, now));
  assert.equal(JSON.stringify(script.sentMessages), JSON.stringify([{ type: 'ready' }]));
  script.clickRefresh();
  assert.equal(JSON.stringify(script.sentMessages.at(-1)), JSON.stringify({ type: 'refresh' }));

  script.refresh.focus();
  script.sendHostMessage({ type: 'busy', busy: true });
  assert.equal(script.refresh.disabled, true);
  assert.equal(script.document.activeElement, script.document.body);
  script.sendHostMessage({ type: 'busy', busy: false });
  assert.equal(script.refresh.disabled, false);
  assert.equal(script.document.activeElement, script.refresh);

  script.sendHostMessage({ type: 'render', html: '<p>new state</p>' });
  assert.equal(script.content.innerHTML, '<p>new state</p>');
});
