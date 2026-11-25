import * as vscode from 'vscode';
import type {
  AccountTokenActivitySnapshot,
  CodexAccountUsageSnapshot as BackendUsageSnapshot,
  EventLike
} from './appServer/types';
import {
  buildCodexAccountUsageDisplay,
  buildCodexAccountUsageViewModel,
  type CodexAccountUsageSnapshot
} from './accountUsage';
import { CodexAccountUsagePanel } from './accountUsagePanel';
import { getProviderConfig } from './config';

const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

export interface AccountUsageSource {
  readonly onDidUpdateRateLimits: EventLike<BackendUsageSnapshot>;
  readonly onDidChangeAccount?: EventLike<void>;
  readRateLimits(): Promise<BackendUsageSnapshot>;
  readTokenActivity?(): Promise<AccountTokenActivitySnapshot>;
}

export class CodexAccountUsageStatusBar implements vscode.Disposable {
  private readonly statusBarItem: vscode.StatusBarItem;
  private readonly dashboard: CodexAccountUsagePanel;
  private readonly disposables: vscode.Disposable[];
  private readonly refreshTimer: ReturnType<typeof setInterval>;
  private lastSnapshot?: CodexAccountUsageSnapshot;
  private refreshInFlight?: Promise<void>;
  private generation = 0;
  private disposed = false;
  private failed = false;
  private selectedModel = getProviderConfig().model;
  private usageSource: AccountUsageSource;
  private sourceSubscriptions: vscode.Disposable[] = [];
  private accountLabel?: string;
  private accountSelection?: 'Last requested account' | 'Manually selected';
  private requestedUsageModel?: string;
  private sourceGeneration = 0;

  constructor(
    private readonly outputChannel: vscode.LogOutputChannel,
    private readonly defaultSource: AccountUsageSource,
    selectAccount?: () => Promise<{ target: AccountUsageSource; label: string } | undefined>
  ) {
    this.usageSource = defaultSource;
    this.dashboard = new CodexAccountUsagePanel(() => this.refreshDashboard(), undefined,
      selectAccount ? async () => {
        const selection = await selectAccount();
        if (selection && !this.disposed) await this.setUsageSource(selection.target, selection.label);
      } : undefined);
    if (selectAccount) {
      this.accountLabel = 'Default account';
      this.dashboard.setAccount(this.accountLabel);
    }
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this.statusBarItem.name = 'Codex Account Limits';
    this.statusBarItem.command = 'codexvs.refreshAccountLimits';
    this.statusBarItem.hide();

    this.refreshTimer = setInterval(() => {
      if (this.lastSnapshot) {
        void this.refresh().catch(() => {});
      }
    }, REFRESH_INTERVAL_MS);

    this.subscribeToSource();
    this.disposables = [
      this.dashboard,
      this.statusBarItem,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('codexvs.model')) {
          this.setSelectedModel(getProviderConfig().model);
        }
      })
    ];
  }

  setSelectedModel(model: string): void {
    if (this.disposed || !model.trim() || model === this.selectedModel) {
      return;
    }
    this.selectedModel = model;
    this.render();
  }

  isShowing(source: AccountUsageSource): boolean {
    return source === this.usageSource;
  }

  async setUsageSource(source: AccountUsageSource, label: string): Promise<void> {
    if (this.disposed) return;
    this.requestedUsageModel = undefined;
    this.updateUsageSource(source, label, 'Manually selected');
    await this.refresh().catch(() => {});
  }

  observeRequestedModel(source: AccountUsageSource, label: string, model: string): void {
    if (this.disposed) return;
    if (source === this.defaultSource) this.selectedModel = model;
    this.requestedUsageModel = model;
    if (this.updateUsageSource(source, label, 'Last requested account')) {
      void this.refresh().catch(() => {});
    }
  }

  private updateUsageSource(source: AccountUsageSource, label: string,
    selection: NonNullable<CodexAccountUsageStatusBar['accountSelection']>): boolean {
    const changed = source !== this.usageSource;
    this.accountLabel = label;
    this.accountSelection = selection;
    this.dashboard.setAccount(`${label} · ${selection}`, changed);
    if (changed) {
      this.sourceSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
      this.sourceGeneration += 1;
      this.usageSource = source;
      this.clear();
      this.subscribeToSource();
    } else {
      this.render();
    }
    return changed;
  }

  private subscribeToSource(): void {
    const source = this.usageSource;
    const generation = this.sourceGeneration;
    this.sourceSubscriptions.push(source.onDidUpdateRateLimits((snapshot) => {
      if (!this.disposed && generation === this.sourceGeneration) this.acceptSnapshot(snapshot);
    }));
    const account = source.onDidChangeAccount?.(() => {
      if (generation === this.sourceGeneration) this.clear();
    });
    if (account) this.sourceSubscriptions.push(account);
  }

  clear(): void {
    if (this.disposed) {
      return;
    }
    this.generation += 1;
    this.refreshInFlight = undefined;
    this.lastSnapshot = undefined;
    this.failed = false;
    this.render();
  }

  refresh(): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    if (this.refreshInFlight) {
      return this.refreshInFlight;
    }
    const generation = this.generation;
    this.failed = false;
    const request = this.refreshNow(generation).finally(() => {
      if (this.refreshInFlight === request) {
        this.refreshInFlight = undefined;
        this.render();
      }
    });
    this.refreshInFlight = request;
    this.render();
    return request;
  }

  async showDetails(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.dashboard.show();
    // refreshNow already renders a safe failure; command callers need no RPC error.
    await this.refresh().catch(() => {});
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.generation += 1;
    this.lastSnapshot = undefined;
    this.refreshInFlight = undefined;
    clearInterval(this.refreshTimer);
    this.sourceSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
    vscode.Disposable.from(...this.disposables).dispose();
  }

  private async refreshDashboard(): Promise<void> {
    await this.refresh();
    // An account change can replace the request while the panel awaits it.
    // Keep its loading/busy continuation pending until the current refresh settles.
    while (!this.disposed && this.refreshInFlight) {
      await this.refreshInFlight;
    }
  }

  private async refreshNow(generation: number): Promise<void> {
    try {
      const snapshot = await this.usageSource.readRateLimits();
      if (!this.disposed && generation === this.generation) {
        this.acceptSnapshot(snapshot);
      }
    } catch {
      if (this.disposed || generation !== this.generation) {
        return;
      }
      this.outputChannel.warn('account rate-limit refresh failed');
      this.failed = true;
      throw new Error('Could not refresh account limits.');
    }
  }

  private acceptSnapshot(snapshot: BackendUsageSnapshot): void {
    this.lastSnapshot = {
      fetchedAt: snapshot.fetchedAt,
      planType: snapshot.planType,
      creditsBalance: snapshot.creditsBalance,
      limits: snapshot.limits.map((limit) => ({ ...limit }))
    };
    this.failed = false;
    this.render();
  }

  private render(): void {
    if (this.disposed) {
      return;
    }
    const model = this.usageSource === this.defaultSource
      ? this.selectedModel : this.requestedUsageModel ?? getProviderConfig().model;
    const view = buildCodexAccountUsageViewModel(
      this.lastSnapshot ?? { fetchedAt: Number.NaN, limits: [] }, model, new Date()
    );
    this.dashboard.update(view, this.failed ? 'refresh-failed'
      : this.refreshInFlight ? 'loading'
        : !view.primaryWindows.length && !view.otherWindows.length ? 'empty'
          : view.isStale ? 'stale' : 'ready');
    const display = this.lastSnapshot
      ? buildCodexAccountUsageDisplay(this.lastSnapshot, model) : undefined;
    if (!display?.compactText) {
      this.statusBarItem.hide();
      return;
    }
    this.statusBarItem.text = this.accountLabel ? `${this.accountLabel.replaceAll('$(', '$ (')} · ${display.compactText}` : display.compactText;
    this.statusBarItem.tooltip = this.accountLabel
      ? [`Account: ${this.accountLabel}`, this.accountSelection, display.tooltip].filter(Boolean).join(' · ')
      : display.tooltip;
    this.statusBarItem.show();
  }
}
