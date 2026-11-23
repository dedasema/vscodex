import * as vscode from 'vscode';
import { NamedAccountRegistry } from './accounts';
import { CodexAccountUsageStatusBar } from './accountUsageStatusBar';
import { CodexAppServerBackend } from './appServer/codexBackend';
import {
  CODEX_INSTALL_COMMAND,
  createRuntimeDiagnostic,
  isCodexCliVersionNewerThanValidated,
  LATEST_VALIDATED_CODEX_CLI_VERSION,
  MINIMUM_CODEX_CLI_VERSION
} from './appServer/runtime';
import { getProviderConfig } from './config';
import { CodexVSProvider } from './provider';
import { VsCodeIntegrationAdvisor } from './vsCodeIntegration';

const CODEX_INSTALL_DOCS = vscode.Uri.parse('https://developers.openai.com/codex/cli');

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const outputChannel = vscode.window.createOutputChannel('CodexVS', { log: true });
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);

  const backend = new CodexAppServerBackend(context, outputChannel);
  const namedAccounts = new NamedAccountRegistry(context.globalState,
    (id) => new CodexAppServerBackend(context, outputChannel, id));
  const accountUsageStatusBar = new CodexAccountUsageStatusBar(
    outputChannel, backend, () => chooseAccount('Select the account shown in Codex limits')
  );
  const integrationAdvisor = new VsCodeIntegrationAdvisor(outputChannel);
  const provider = new CodexVSProvider(
    outputChannel,
    backend,
    accountUsageStatusBar,
    integrationAdvisor,
    namedAccounts
  );
  let activeLogin: { readonly target: CodexAppServerBackend; id?: string } | undefined;

  const chooseAccount = async (title: string) => {
    const accounts = namedAccounts.list();
    if (accounts.length === 0) return { target: backend, label: 'Default account' };
    const selected = await vscode.window.showQuickPick([
      { label: 'Default account', description: 'Existing private login', id: undefined },
      ...accounts.map((account) => ({ ...account, description: 'Named account' }))
    ], { title });
    if (!selected) return undefined;
    const target = selected.id ? namedAccounts.get(selected.id) : backend;
    return target ? { target, label: selected.label } : undefined;
  };

  const signIn = async (kind: 'browser' | 'deviceCode'): Promise<void> => {
    const selected = await chooseAccount('Select the Codex account to sign in');
    if (!selected) return;
    const { target } = selected;
    if (activeLogin) {
      await vscode.window.showInformationMessage('A ChatGPT sign-in is already in progress.');
      return;
    }

    const login: { target: CodexAppServerBackend; id?: string } = { target };
    activeLogin = login;
    try {
      const loginChallenge = await target.beginLogin(kind);
      login.id = loginChallenge.loginId;
      if (loginChallenge.kind === 'browser') {
        await vscode.env.openExternal(vscode.Uri.parse(loginChallenge.authUrl));
      } else {
        const action = await vscode.window.showInformationMessage(
          `Enter device code ${loginChallenge.userCode} to sign in to ChatGPT.`,
          'Copy Code and Open',
          'Open Verification Page',
          'Cancel'
        );
        if (action === 'Cancel' || !action) {
          await target.cancelLogin(loginChallenge.loginId);
          return;
        }
        if (action === 'Copy Code and Open') {
          await vscode.env.clipboard.writeText(loginChallenge.userCode);
        }
        await vscode.env.openExternal(vscode.Uri.parse(loginChallenge.verificationUrl));
      }

      const account = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: loginChallenge.kind === 'browser'
          ? 'Waiting for ChatGPT browser sign-in…'
          : 'Waiting for ChatGPT device-code sign-in…',
        cancellable: true
      }, async (_progress, cancellationToken) => {
        const cancellation = cancellationToken.onCancellationRequested(() => {
          void target.cancelLogin(loginChallenge.loginId).catch(() => undefined);
        });
        try {
          return await loginChallenge.completion;
        } finally {
          cancellation.dispose();
        }
      });
      await vscode.window.showInformationMessage(`Signed in to ChatGPT (${account.planType}).`);
      provider.refreshAccounts();
      if (accountUsageStatusBar.isShowing(target)) await accountUsageStatusBar.refresh().catch(() => {});
    } catch (error) {
      if (error instanceof vscode.CancellationError
        || (error instanceof Error && error.name === 'LoginCancelledError')) {
        await vscode.window.showInformationMessage('ChatGPT sign-in was cancelled.');
      } else {
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'ChatGPT sign-in failed.');
      }
    } finally {
      if (activeLogin === login) activeLogin = undefined;
    }
  };

  const checkRuntime = async (): Promise<void> => {
    try {
      await backend.ensureReady();
      const runtimeVersion = backend.runtimeVersion ?? MINIMUM_CODEX_CLI_VERSION;
      await vscode.window.showInformationMessage(
        `Codex app-server is ready (codex-cli ${runtimeVersion}).`
      );
      if (isCodexCliVersionNewerThanValidated(runtimeVersion)) {
        await vscode.window.showWarningMessage(
          `Codex CLI ${runtimeVersion} is newer than ${LATEST_VALIDATED_CODEX_CLI_VERSION}, the latest version validated for this CodexVS release. Compatibility will be checked as features are used.`
        );
      }
    } catch (error) {
      const diagnostic = createRuntimeDiagnostic(error, vscode.env.remoteName);
      const action = await vscode.window.showErrorMessage(
        diagnostic.detail,
        'Open Installation Documentation',
        'Copy Install Command',
        'Configure Executable',
        'Retry'
      );
      if (action === 'Open Installation Documentation') {
        await vscode.env.openExternal(CODEX_INSTALL_DOCS);
      } else if (action === 'Copy Install Command') {
        await vscode.env.clipboard.writeText(CODEX_INSTALL_COMMAND);
        await vscode.window.showInformationMessage('Codex installation command copied.');
      } else if (action === 'Configure Executable') {
        await vscode.commands.executeCommand('codexvs.configureExecutable');
      } else if (action === 'Retry') {
        await vscode.commands.executeCommand('codexvs.checkRuntime');
      }
    }
  };

  context.subscriptions.push(
    outputChannel,
    backend,
    namedAccounts,
    accountUsageStatusBar,
    provider,
    vscode.lm.registerLanguageModelChatProvider('codexvs', provider),
    vscode.commands.registerCommand('codexvs.openDebugLogs', () => {
      outputChannel.show(true);
    }),
    vscode.commands.registerCommand('codexvs.openSettings', () => {
      return vscode.commands.executeCommand('workbench.action.openSettings', 'CodexVS');
    }),
    vscode.commands.registerCommand(
      'codexvs.signInWithChatGPT',
      () => signIn(vscode.env.remoteName ? 'deviceCode' : 'browser')
    ),
    vscode.commands.registerCommand('codexvs.signInWithDeviceCode', () => signIn('deviceCode')),
    vscode.commands.registerCommand('codexvs.addAccount', async () => {
      const label = await vscode.window.showInputBox({ title: 'Add Codex Account', prompt: 'Enter a label for the account.' });
      if (label === undefined) return;
      try {
        const account = await namedAccounts.add(label);
        provider.refreshAccounts();
        await vscode.window.showInformationMessage(`Created “${account.label}”. Run “Codex: Sign In with ChatGPT” and select that account.`);
      } catch (error) {
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not add the account.');
      }
    }),
    vscode.commands.registerCommand('codexvs.cancelSignIn', async () => {
      const login = activeLogin;
      if (!login?.id) {
        await vscode.window.showInformationMessage('No ChatGPT sign-in is in progress.');
        return;
      }
      await login.target.cancelLogin(login.id);
    }),
    vscode.commands.registerCommand('codexvs.showAccountStatus', async () => {
      try {
        const selected = await chooseAccount('Select the Codex account to inspect');
        if (!selected) return;
        const account = await selected.target.readAccount(false);
        await vscode.window.showInformationMessage(account
          ? `CodexVS: ${selected.label} is signed in with ChatGPT (${account.planType}).`
          : `CodexVS: ${selected.label} is not signed in with ChatGPT.`);
      } catch (error) {
        await vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Could not read Codex account status.');
      }
    }),
    vscode.commands.registerCommand('codexvs.signOut', async () => {
      const selected = await chooseAccount('Select the Codex account to sign out');
      if (!selected) return;
      const confirmation = await vscode.window.showWarningMessage(
        `Signing out removes only the private ChatGPT login for “${selected.label}”. Other Codex clients and accounts are unaffected.`,
        { modal: true },
        'Sign Out of Codex'
      );
      if (confirmation !== 'Sign Out of Codex') {
        return;
      }
      await selected.target.logout();
      if (accountUsageStatusBar.isShowing(selected.target)) accountUsageStatusBar.clear();
      provider.refreshAccounts();
      await vscode.window.showInformationMessage('Signed out of the private CodexVS ChatGPT account.');
    }),
    vscode.commands.registerCommand('codexvs.checkRuntime', checkRuntime),
    vscode.commands.registerCommand(
      'codexvs.configureUtilityModels',
      () => integrationAdvisor.configureUtilityModels()
    ),
    vscode.commands.registerCommand(
      'codexvs.configureReasoningEffort',
      () => integrationAdvisor.configureReasoningEffort(backend)
    ),
    vscode.commands.registerCommand(
      'codexvs.showIntegrationDiagnostics',
      () => integrationAdvisor.showDiagnostics(backend)
    ),
    vscode.commands.registerCommand('codexvs.configureExecutable', async () => {
      const configured = await vscode.window.showInputBox({
        title: 'Configure Codex Executable',
        prompt: `Enter a Codex CLI ${MINIMUM_CODEX_CLI_VERSION} or newer executable or launcher on this extension host.`,
        value: getProviderConfig().appServerCommand,
        ignoreFocusOut: true
      });
      if (!configured?.trim()) {
        return;
      }
      await vscode.workspace.getConfiguration('codexvs').update(
        'appServer.command',
        configured.trim(),
        vscode.ConfigurationTarget.Global
      );
      await vscode.window.showInformationMessage('Codex executable updated. Run “Codex: Check App-server Runtime” to validate it.');
    }),
    vscode.commands.registerCommand('codexvs.refreshAccountLimits', async () => {
      await accountUsageStatusBar.showDetails();
    }),
    vscode.commands.registerCommand('codexvs.manage', async () => {
      const actions = new Map<string, string>([
        ['Add Codex Account', 'codexvs.addAccount'],
        ['Sign in with ChatGPT', 'codexvs.signInWithChatGPT'],
        ['Sign in with Device Code', 'codexvs.signInWithDeviceCode'],
        ['Cancel Sign-in', 'codexvs.cancelSignIn'],
        ['Show Account Status', 'codexvs.showAccountStatus'],
        ['Sign Out of Codex', 'codexvs.signOut'],
        ['Check App-server Runtime', 'codexvs.checkRuntime'],
        ['Configure Reasoning Effort', 'codexvs.configureReasoningEffort'],
        ['Configure VS Code Utility Models', 'codexvs.configureUtilityModels'],
        ['Show Integration Diagnostics', 'codexvs.showIntegrationDiagnostics'],
        ['Configure Codex Executable', 'codexvs.configureExecutable'],
        ['Show Account Limits', 'codexvs.refreshAccountLimits'],
        ['Open Debug Logs', 'codexvs.openDebugLogs'],
        ['Open Settings', 'codexvs.openSettings']
      ]);
      const action = await vscode.window.showQuickPick([...actions.keys()], { title: 'CodexVS' });
      const command = action ? actions.get(action) : undefined;
      if (command) {
        await vscode.commands.executeCommand(command);
      }
    })
  );

}

export function deactivate(): void {}
