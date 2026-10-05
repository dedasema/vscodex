import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { CodexAccountUsageViewModel } from './accountUsage';
import {
  renderAccountUsageDashboardHtml,
  renderAccountUsagePanelHtml,
  type AccountUsagePanelState
} from './accountUsagePanelView';

export class CodexAccountUsagePanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private panelSubscriptions: vscode.Disposable[] = [];
  private model?: CodexAccountUsageViewModel;
  private state: AccountUsagePanelState = 'loading';
  private refreshInFlight = false;
  private webviewReady = false;
  private webviewGeneration = 0;
  private disposed = false;

  constructor(
    private readonly onRefresh: () => void | Promise<void>,
    private readonly clock: () => number = () => Date.now()
  ) {}

  update(model: CodexAccountUsageViewModel | undefined, state: AccountUsagePanelState): void {
    if (this.disposed) return;
    this.model = model;
    this.state = state;
    this.publishState();
  }

  show(): void {
    if (this.disposed) return;
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside, false);
      this.publishState(this.panel);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'codexvs.accountLimits',
      'Codex Account Limits',
      vscode.ViewColumn.Beside,
      { enableScripts: true, localResourceRoots: [] }
    );
    this.panel = panel;
    this.webviewReady = false;
    this.panelSubscriptions = [
      panel.onDidDispose(() => this.clearPanel(panel)),
      panel.onDidChangeViewState(({ webviewPanel }) => this.handleVisibility(panel, webviewPanel.visible)),
      panel.webview.onDidReceiveMessage((message: unknown) => { void this.handleMessage(panel, message); })
    ];
    panel.webview.html = renderAccountUsagePanelHtml(
      randomBytes(16).toString('base64'), this.model, this.state,
      this.refreshInFlight, this.clock()
    );
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const panel = this.panel;
    if (panel) {
      this.clearPanel(panel);
      panel.dispose();
    }
  }

  private async handleMessage(panel: vscode.WebviewPanel, message: unknown): Promise<void> {
    if (this.disposed || panel !== this.panel) return;
    const kind = getMessageKind(message);
    if (kind === 'ready') {
      this.webviewReady = true;
      this.webviewGeneration += 1;
      this.publishState(panel);
      return;
    }
    if (kind !== 'refresh' || this.refreshInFlight) return;

    this.refreshInFlight = true;
    this.state = 'loading';
    this.publishState(panel);
    try {
      await this.onRefresh();
      if (this.state === 'loading') {
        this.state = this.model
          ? this.model.isStale || this.model.freshness === 'stale' ? 'stale' : 'ready'
          : 'empty';
        this.publishState();
      }
    } catch {
      this.state = 'refresh-failed';
      this.publishState();
    } finally {
      this.refreshInFlight = false;
      this.publishState();
    }
  }

  private handleVisibility(panel: vscode.WebviewPanel, visible: boolean): void {
    if (panel !== this.panel) return;
    this.webviewGeneration += 1;
    this.webviewReady = visible;
    if (visible) this.publishState(panel);
  }

  private publishState(panel = this.panel): void {
    if (!panel || panel !== this.panel || !this.webviewReady) return;
    this.post(panel, {
      type: 'render',
      html: renderAccountUsageDashboardHtml(this.model, this.state, this.clock())
    });
    this.post(panel, { type: 'busy', busy: this.refreshInFlight });
  }

  private post(panel: vscode.WebviewPanel, message: WebviewMessage): void {
    if (panel !== this.panel || !this.webviewReady) return;
    const generation = this.webviewGeneration;
    try {
      void panel.webview.postMessage(message).then((sent) => {
        if (!sent && this.isCurrentGeneration(panel, generation)) this.webviewReady = false;
      }, () => {
        if (this.isCurrentGeneration(panel, generation)) this.webviewReady = false;
      });
    } catch {
      if (this.isCurrentGeneration(panel, generation)) this.webviewReady = false;
    }
  }

  private isCurrentGeneration(panel: vscode.WebviewPanel, generation: number): boolean {
    return panel === this.panel && generation === this.webviewGeneration;
  }

  private clearPanel(panel: vscode.WebviewPanel): void {
    if (panel !== this.panel) return;
    this.panel = undefined;
    this.webviewReady = false;
    this.webviewGeneration += 1;
    this.panelSubscriptions.splice(0).forEach((subscription) => subscription.dispose());
  }
}

type WebviewMessage = { type: 'render'; html: string } | { type: 'busy'; busy: boolean };

function getMessageKind(message: unknown): 'ready' | 'refresh' | undefined {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  const keys = Reflect.ownKeys(message);
  if (keys.length !== 1 || keys[0] !== 'type') return undefined;
  const type = (message as { type?: unknown }).type;
  return type === 'ready' || type === 'refresh' ? type : undefined;
}
