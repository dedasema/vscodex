import type { AccountUsageWindowViewModel, CodexAccountUsageViewModel } from './accountUsage';

const STALE_AFTER_MS = 15 * 60 * 1000;

export type AccountUsagePanelState = 'loading' | 'empty' | 'refresh-failed' | 'stale' | 'ready';

export function renderAccountUsagePanelHtml(
  nonce: string,
  model: CodexAccountUsageViewModel | undefined,
  state: AccountUsagePanelState,
  refreshBusy: boolean,
  now: number
): string {
  const safeNonce = escapeHtml(nonce);
  const policy = [
    "default-src 'none'; img-src 'none'; connect-src 'none'; font-src 'none';",
    "media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none';",
    `style-src 'nonce-${safeNonce}'; script-src 'nonce-${safeNonce}'`
  ].join(' ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="${policy}">
<title>Codex Account Limits</title>
<style nonce="${safeNonce}">
:root { color-scheme: light dark; }
body { margin: 0; padding: 1rem; color: var(--vscode-foreground); background: var(--vscode-editor-background); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); }
header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
h1 { margin: 0; font-size: 1.25rem; }
h2 { margin: 1.2rem 0 .5rem; font-size: 1rem; }
h3 { margin: 0; font-size: 1rem; }
button { border: 0; border-radius: 2px; padding: .4rem .7rem; color: var(--vscode-button-foreground); background: var(--vscode-button-background); font: inherit; cursor: pointer; }
button:hover { background: var(--vscode-button-hoverBackground); }
button:focus-visible { outline: 2px solid var(--vscode-focusBorder); outline-offset: 2px; }
button:disabled { opacity: .65; cursor: wait; }
.status, .freshness, .detail { color: var(--vscode-descriptionForeground); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); gap: .75rem; }
.card { min-width: 0; padding: .9rem; border: 1px solid var(--vscode-panel-border, var(--vscode-widget-border)); border-radius: 4px; background: var(--vscode-sideBar-background, var(--vscode-editor-background)); }
.card p { margin: .5rem 0 0; }
.percentages { display: flex; flex-wrap: wrap; gap: .35rem 1rem; }
progress { display: block; width: 100%; height: .7rem; margin-top: .6rem; accent-color: var(--vscode-progressBar-background); }
dl { display: flex; flex-wrap: wrap; gap: .4rem 1.25rem; }
dt { display: inline; color: var(--vscode-descriptionForeground); }
dd { display: inline; margin: 0; }
@media (forced-colors: active) {
  body, .card { color: CanvasText; background: Canvas; }
  .card { border: 1px solid CanvasText; }
  button { color: ButtonText; background: ButtonFace; border: 1px solid ButtonText; }
  button:focus-visible { outline-color: Highlight; }
  progress { accent-color: Highlight; }
}
</style>
</head>
<body>
<header><h1>Codex Account Limits</h1><button id="refresh" type="button"${refreshBusy ? ' disabled' : ''}>Refresh</button></header>
<main id="content" aria-live="polite">${renderAccountUsageDashboardHtml(model, state, now)}</main>
<script nonce="${safeNonce}">
const vscode = acquireVsCodeApi();
const content = document.getElementById('content');
const refresh = document.getElementById('refresh');
let restoreRefreshFocus = false;
refresh.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
window.addEventListener('message', ({ data }) => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const keys = Reflect.ownKeys(data);
  if (data.type === 'render' && keys.length === 2 && keys.includes('type') && keys.includes('html') && typeof data.html === 'string') {
    const keepFocus = document.activeElement === refresh;
    content.innerHTML = data.html;
    if (keepFocus) refresh.focus();
  } else if (data.type === 'busy' && keys.length === 2 && keys.includes('type') && keys.includes('busy') && typeof data.busy === 'boolean') {
    if (data.busy && document.activeElement === refresh) restoreRefreshFocus = true;
    refresh.disabled = data.busy;
    if (!data.busy && restoreRefreshFocus) {
      refresh.focus();
      restoreRefreshFocus = false;
    }
  }
});
vscode.postMessage({ type: 'ready' });
</script>
</body>
</html>`;
}

export function renderAccountUsageDashboardHtml(
  model: CodexAccountUsageViewModel | undefined,
  state: AccountUsagePanelState,
  now: number
): string {
  const freshness = getFreshness(model, state, now);
  const status = state === 'loading'
    ? 'Refreshing account limits…'
    : state === 'empty'
      ? 'No account limit data is available.'
      : state === 'refresh-failed'
        ? 'Could not refresh account limits. Try again.'
        : freshness.stale
          ? 'Showing older account limits. Refresh to update.'
          : freshness.known
            ? 'Account limits are current.'
            : 'Fetch time unknown; freshness cannot be confirmed.';
  const parts = [`<p class="status" role="status">${status}</p>`];

  if (model) {
    parts.push(`<p class="freshness">Data freshness: ${freshness.label} · ${freshness.detail}</p>`);
    const metadata: string[] = [];
    if (model.planType?.trim()) {
      metadata.push(`<div><dt>Plan:</dt> <dd>${escapeHtml(model.planType.trim())}</dd></div>`);
    }
    if (model.creditsBalance !== undefined && Number.isFinite(model.creditsBalance) && model.creditsBalance >= 0) {
      metadata.push(`<div><dt>Credits balance:</dt> <dd>${formatCredits(model.creditsBalance)}</dd></div>`);
    }
    if (metadata.length > 0) {
      parts.push(`<dl>${metadata.join('')}</dl>`);
    }

    parts.push(renderWindowGroup('Primary limits', model.primaryWindows));
    parts.push(renderWindowGroup('Other windows', model.otherWindows));
    if (model.primaryWindows.length + model.otherWindows.length === 0) {
      parts.push('<p>No account limit windows were returned.</p>');
    }
  } else if (state === 'empty') {
    parts.push('<p>No account limit windows were returned.</p>');
  }

  return parts.join('');
}

function getFreshness(
  model: CodexAccountUsageViewModel | undefined,
  state: AccountUsagePanelState,
  now: number
): { label: string; detail: string; known: boolean; stale: boolean } {
  if (!model || !Number.isFinite(model.fetchedAt)) {
    return { label: 'Unknown', detail: 'Fetch time unknown.', known: false, stale: state === 'stale' };
  }

  const fetchedAt = new Date(model.fetchedAt);
  if (Number.isNaN(fetchedAt.getTime())) {
    return { label: 'Unknown', detail: 'Fetch time unknown.', known: false, stale: state === 'stale' };
  }

  const timestamp = fetchedAt.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  if (!Number.isFinite(now) || now < model.fetchedAt) {
    return {
      label: 'Unknown',
      detail: `Fetched ${escapeHtml(timestamp)}; age unavailable.`,
      known: false,
      stale: state === 'stale'
    };
  }

  const age = now - model.fetchedAt;
  const stale = state === 'stale' || model.isStale || model.freshness === 'stale' || age > STALE_AFTER_MS;
  return {
    label: stale ? 'Stale' : 'Fresh',
    detail: `Fetched ${escapeHtml(timestamp)} (${formatAge(age)}).`,
    known: true,
    stale
  };
}

function renderWindowGroup(title: string, windows: readonly AccountUsageWindowViewModel[]): string {
  if (windows.length === 0) {
    return '';
  }

  return `<section><h2>${escapeHtml(title)}</h2><div class="cards">${windows.map(renderWindow).join('')}</div></section>`;
}

function renderWindow(window: AccountUsageWindowViewModel): string {
  const label = escapeHtml(window.label);
  const limit = window.limitName?.trim();
  const details = limit ? `<p class="detail">${escapeHtml(limit)}</p>` : '';
  const used = boundedPercent(window.usedPercent);
  const remaining = boundedPercent(window.remainingPercent);
  const progress = used === undefined || remaining === undefined
    ? '<p>Usage percentages are unavailable.</p>'
    : `<p class="percentages"><span>${used}% used</span><span>${remaining}% remaining</span></p><progress max="100" value="${used}" aria-label="${escapeHtml(limit ? `${window.label} (${limit})` : window.label)}: ${used}% used, ${remaining}% remaining">${used}% used</progress>`;
  const resets = [window.resetAtLabel, window.resetRelativeLabel]
    .filter((value): value is string => Boolean(value))
    .map(escapeHtml);
  const reset = resets.length > 0 ? `<p class="detail">Resets: ${resets.join(' · ')}</p>` : '';

  return `<article class="card"><h3>${label}</h3>${details}${progress}${reset}</article>`;
}

function formatAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'less than a minute ago';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]!);
}

function boundedPercent(value: number): number | undefined {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(100, value))) : undefined;
}

function formatCredits(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(1)));
}
