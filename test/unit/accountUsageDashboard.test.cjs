'use strict';

const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildSync } = require('esbuild');

const repositoryRoot = path.resolve(__dirname, '../..');
const temporaryDirectory = mkdtempSync(path.join(os.tmpdir(), 'codex-account-usage-dashboard-'));
const bundlePath = path.join(temporaryDirectory, 'accountUsage.cjs');

buildSync({
  entryPoints: [path.join(repositoryRoot, 'src/accountUsage.ts')],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: bundlePath
});

test.after(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

const {
  buildCodexAccountUsageDisplay,
  buildCodexAccountUsageViewModel
} = require(bundlePath);
const NOW = new Date('2025-06-10T12:00:00.000Z');
const NOW_MS = NOW.getTime();

test('uses the compact selector for ordered primary windows across pools and models', () => {
  const snapshot = {
    fetchedAt: NOW_MS,
    planType: 'pro',
    creditsBalance: 12.5,
    limits: [
      makeLimit('pool-week-current', 'gpt-5.5', 10080, 30),
      makeLimit('pool-five-current', 'gpt-5.5', 300, 60),
      makeLimit('pool-week-other', 'gpt-4.1', 10080, 90),
      makeLimit('codex', 'gpt-4.1', 300, 80),
      makeLimit('short-window', 'Burst', 90, 50),
      makeLimit('daily', 'Daily', 1440, 0)
    ]
  };

  const view = buildCodexAccountUsageViewModel(snapshot, 'gpt-5.5', NOW);
  assert.equal(view.planType, 'pro');
  assert.equal(view.creditsBalance, 12.5);
  assert.deepEqual(view.primaryWindows.map(({ kind, limitId }) => [kind, limitId]), [
    ['5h', 'codex'],
    ['weekly', 'pool-week-current']
  ]);
  assert.deepEqual(view.primaryWindows.map(({ usedPercent, remainingPercent }) => [usedPercent, remainingPercent]), [
    [80, 20],
    [30, 70]
  ]);
  assert.deepEqual(view.otherWindows.map(({ kind }) => kind), ['5h', 'weekly', 'daily', 'other']);
  assert.equal(view.otherWindows.find(({ limitId }) => limitId === 'short-window').windowMinutes, 90);
  assert.equal(view.otherWindows.find(({ limitId }) => limitId === 'short-window').label, 'Other (90 minutes)');

  const otherModelView = buildCodexAccountUsageViewModel(snapshot, 'gpt-4.1', NOW);
  assert.equal(otherModelView.primaryWindows[1].limitId, 'pool-week-other');
  const display = buildCodexAccountUsageDisplay(snapshot, 'gpt-5.5', NOW_MS);
  assert.match(display.compactText, /5h 20% left/);
  assert.match(display.compactText, /wk 70% left/);
  assert.match(display.tooltip, /20% remaining/);
  assert.match(display.tooltip, /80% used/);
});

test('keeps empty and metadata-free snapshots honest', () => {
  const empty = buildCodexAccountUsageViewModel({ fetchedAt: NOW_MS, limits: [] }, 'gpt-5.5', NOW);
  assert.deepEqual(empty.primaryWindows, []);
  assert.deepEqual(empty.otherWindows, []);
  assert.equal('planType' in empty, false);
  assert.equal('creditsBalance' in empty, false);
  assert.equal('tokens' in empty, false);
  assert.equal(buildCodexAccountUsageDisplay({ fetchedAt: NOW_MS, limits: [] }, 'gpt-5.5', NOW_MS).compactText, undefined);

  const metadataFree = buildCodexAccountUsageViewModel({
    fetchedAt: NOW_MS,
    limits: [makeLimit(undefined, undefined, 300, 0)]
  }, 'gpt-5.5', NOW);
  assert.equal(metadataFree.primaryWindows.length, 1);
  assert.equal('limitId' in metadataFree.primaryWindows[0], false);
  assert.equal('limitName' in metadataFree.primaryWindows[0], false);
  assert.equal('resetAt' in metadataFree.primaryWindows[0], false);
});

test('exposes explicit percentage extremes and honest reset labels', () => {
  const snapshot = {
    fetchedAt: NOW_MS,
    limits: [
      { ...makeLimit('future', 'Future', 300, 0), resetAt: NOW_MS + 90 * 60 * 1000 },
      { ...makeLimit('past', 'Past', 10080, 100), resetAt: NOW_MS - 60 * 60 * 1000 },
      makeLimit('unknown-reset', 'Unknown reset', 1440, 0),
      { ...makeLimit('now', 'Now', 90, 50), resetAt: NOW_MS }
    ]
  };
  const view = buildCodexAccountUsageViewModel(snapshot, 'gpt-5.5', NOW);
  const fiveHour = view.primaryWindows[0];
  const weekly = view.primaryWindows[1];
  const noReset = view.otherWindows.find(({ limitId }) => limitId === 'unknown-reset');
  const resetNow = view.otherWindows.find(({ limitId }) => limitId === 'now');

  assert.equal(fiveHour.usedPercent, 0);
  assert.equal(fiveHour.remainingPercent, 100);
  assert.match(fiveHour.resetAtLabel, /2025/);
  assert.equal(fiveHour.resetAtLabel, new Date(fiveHour.resetAt).toLocaleString('en-US', {
    dateStyle: 'medium', timeStyle: 'short'
  }));
  assert.equal(fiveHour.resetRelativeLabel, 'in 1 hour 30 minutes');
  assert.equal(weekly.usedPercent, 100);
  assert.equal(weekly.remainingPercent, 0);
  assert.equal(weekly.resetRelativeLabel, 'Reset time passed 1 hour ago');
  assert.doesNotMatch(weekly.resetRelativeLabel, /available|refreshed/i);
  assert.equal('resetAt' in noReset, false);
  assert.equal('resetAtLabel' in noReset, false);
  assert.equal('resetRelativeLabel' in noReset, false);
  assert.equal(resetNow.resetRelativeLabel, 'Reset time is now');
});

test('formats reset times in the host zone without changing timestamps or relative labels', () => {
  const previousZone = process.env.TZ;
  const fetchedAt = Date.parse('2026-10-04T21:22:49.733Z');
  const resetAt = fetchedAt + 60 * 60 * 1000;
  try {
    for (const [zone, hour, day] of [['America/Los_Angeles', 15, 4], ['Asia/Kolkata', 3, 5]]) {
      process.env.TZ = zone;
      assert.equal(new Date(resetAt).getHours(), hour);
      assert.equal(new Date(resetAt).getDate(), day);
      const snapshot = {
        fetchedAt,
        limits: [300, 1440].map((minutes) => ({ ...makeLimit('codex', undefined, minutes, 25), resetAt }))
      };
      const view = buildCodexAccountUsageViewModel(snapshot, 'gpt-5.5', new Date(fetchedAt));
      const expected = new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium', timeStyle: 'short', timeZone: zone
      }).format(resetAt);
      assert.equal(view.fetchedAt, fetchedAt);
      for (const window of [...view.primaryWindows, ...view.otherWindows]) {
        assert.equal(window.resetAt, resetAt);
        assert.equal(window.resetRelativeLabel, 'in 1 hour');
        assert.equal(window.resetAtLabel, expected);
      }
      assert.equal(snapshot.limits[0].resetAt, resetAt);
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test('derives freshness from the injected date at the stale threshold', () => {
  const threshold = 15 * 60 * 1000;
  const snapshot = { fetchedAt: NOW_MS - threshold, limits: [] };

  assert.equal(buildCodexAccountUsageViewModel(snapshot, 'gpt-5.5', NOW).freshness, 'fresh');
  assert.equal(buildCodexAccountUsageViewModel(snapshot, 'gpt-5.5', new Date(NOW_MS + 1)).freshness, 'stale');
  assert.equal(buildCodexAccountUsageViewModel({ ...snapshot, fetchedAt: NOW_MS - threshold - 1 }, 'gpt-5.5', NOW).isStale, true);
  assert.equal(buildCodexAccountUsageViewModel({ ...snapshot, fetchedAt: NOW_MS + 1 }, 'gpt-5.5', NOW).freshness, 'fresh');
});

function makeLimit(limitId, limitName, windowMinutes, usedPercent) {
  const limit = {
    windowMinutes,
    usedPercent,
    remainingPercent: 100 - usedPercent
  };
  if (limitId !== undefined) {
    limit.limitId = limitId;
  }
  if (limitName !== undefined) {
    limit.limitName = limitName;
  }
  return limit;
}
