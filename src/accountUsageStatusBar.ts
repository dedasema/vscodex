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

  constructor(
    private readonly outputChannel: vscode.LogOutputChannel,
    private readonly usageSource: AccountUsageSource
  ) {
    this.dashboard = new CodexAccountUsagePanel(() => this.refreshDashboard());
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
    this.statusBarItem.name = 'Codex Account Limits';
    this.statusBarItem.command = 'codexvs.refreshAccountLimits';
    this.statusBarItem.hide();

    this.refreshTimer = setInterval(() => {
      if (this.lastSnapshot) {
        void this.refresh().catch(() => {});
      }
    }, REFRESH_INTERVAL_MS);

    const rateLimitSubscription = this.usageSource.onDidUpdateRateLimits((snapshot) => {
      if (!this.disposed) {
        this.acceptSnapshot(snapshot);
      }
    });
    const accountSubscription = this.usageSource.onDidChangeAccount?.(() => this.clear());
    this.disposables = [
      this.dashboard,
      this.statusBarItem,
      rateLimitSubscription,
      ...(accountSubscription ? [accountSubscription] : []),
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
    const view = buildCodexAccountUsageViewModel(
      this.lastSnapshot ?? { fetchedAt: Number.NaN, limits: [] }, this.selectedModel, new Date()
    );
    this.dashboard.update(view, this.failed ? 'refresh-failed'
      : this.refreshInFlight ? 'loading'
        : !view.primaryWindows.length && !view.otherWindows.length ? 'empty'
          : view.isStale ? 'stale' : 'ready');
    const display = this.lastSnapshot
      ? buildCodexAccountUsageDisplay(this.lastSnapshot, this.selectedModel) : undefined;
    if (!display?.compactText) {
      this.statusBarItem.hide();
      return;
    }
    this.statusBarItem.text = display.compactText;
    this.statusBarItem.tooltip = display.tooltip;
    this.statusBarItem.show();
  }
}
