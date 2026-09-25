import { spawn } from 'node:child_process';
import readline from 'node:readline';

const command = process.platform === 'win32' ? 'codex.cmd' : 'codex';
const DYNAMIC_TOOL_NAME = 'vscode_codexvs_probe_tool';

const APP_SERVER_ARGUMENTS = Object.freeze([
    '-c', 'web_search="disabled"',
    '-c', 'mcp_servers={}',
    '-c', 'skills.config=[]',
    '-c', 'project_doc_max_bytes=0',
    '--disable', 'shell_tool',
    '--disable', 'unified_exec',
    '--disable', 'shell_snapshot',
    '--disable', 'apps',
    '--disable', 'browser_use',
    '--disable', 'browser_use_external',
    '--disable', 'computer_use',
    '--disable', 'image_generation',
    '--disable', 'in_app_browser',
    '--disable', 'code_mode_host',
    '--disable', 'multi_agent',
    '--disable', 'multi_agent_v2',
    '--disable', 'plugins',
    '--disable', 'plugin_sharing',
    '--disable', 'remote_plugin',
    '--disable', 'hooks',
    '--disable', 'goals',
    '--disable', 'memories',
    '--disable', 'workspace_dependencies',
    '--disable', 'skill_mcp_dependency_install',
    '--disable', 'tool_suggest',
    'app-server',
    '--stdio'
]);

const PASSIVE_PROVIDER_INSTRUCTIONS = `
You are the reasoning backend for a VS Code LanguageModelChatProvider.
VS Code and its calling agent own context selection, workspace permissions,
tool execution, file changes, commands, approvals, and subagents. The app-server
cwd, sandbox, and approval policy protect this passive backend only; they do not
describe or restrict the caller's VS Code workspace. Never report that VS Code
is read-only based on backend metadata. Call only supplied dynamic tools whose
names begin with vscode_. Never invoke Codex built-in tools, including shell,
filesystem, MCP, web, or collaboration/spawn_agent tools. For subagent work,
use a supplied dynamic VS Code agent or subagent tool. Return normal assistant
text and dynamic tool calls.
`.trim();

const child = spawn(command, APP_SERVER_ARGUMENTS, {
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
    windowsHide: true
});

const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity
});

let nextId = 1;
const pending = new Map();

let sawDynamicToolCall = false;
let completed = false;

let resolveTurnCompleted;
const turnCompleted = new Promise((resolve) => {
    resolveTurnCompleted = resolve;
});

function write(message) {
    child.stdin.write(JSON.stringify(message) + '\n');
}

function request(method, params = {}) {
    const id = nextId++;

    write({
        method,
        id,
        params
    });

    return new Promise((resolve, reject) => {
        pending.set(id, {
            method,
            resolve,
            reject
        });
    });
}

function notify(method, params) {
    const message = { method };

    if (params !== undefined) {
        message.params = params;
    }

    write(message);
}

child.stderr.on('data', (chunk) => {
    process.stderr.write(`[app-server stderr] ${chunk}`);
});

child.on('exit', (code, signal) => {
    if (!completed) {
        console.log(
            `\napp-server exited unexpectedly. code=${code} signal=${signal}`
        );
    }
});

rl.on('line', (line) => {
    if (!line.trim()) {
        return;
    }

    let message;

    try {
        message = JSON.parse(line);
    } catch {
        console.log('[NON JSON]', line);
        return;
    }

    /*
     * Respuesta a una petición nuestra.
     */
    if (
        Object.prototype.hasOwnProperty.call(message, 'id') &&
        !message.method
    ) {
        const entry = pending.get(message.id);

        if (entry) {
            pending.delete(message.id);

            if (message.error) {
                entry.reject(
                    new Error(
                        `${entry.method}: ${JSON.stringify(message.error)}`
                    )
                );
            } else {
                entry.resolve(message.result);
            }
        }

        return;
    }

    /*
     * Petición del servidor para ejecutar nuestra dynamic tool.
     */
    if (message.method === 'item/tool/call') {
        sawDynamicToolCall = true;

        console.log('\n=== DYNAMIC TOOL CALL ===');
        console.log('tool:', message.params?.tool);
        console.log(
            'arguments:',
            JSON.stringify(message.params?.arguments)
        );

        write({
            id: message.id,
            result: {
                contentItems: [
                    {
                        type: 'inputText',
                        text: 'CodexVS dynamic-tool probe executed successfully.'
                    }
                ],
                success: true
            }
        });

        return;
    }

    /*
     * Eventos relevantes.
     */
    if (
        message.method === 'turn/started' ||
        message.method === 'item/started' ||
        message.method === 'item/completed'
    ) {
        const type =
            message.params?.item?.type ??
            message.params?.turn?.status ??
            '';

        console.log(`[${message.method}]`, type);
    }

    if (message.method === 'turn/completed') {
        completed = true;

        console.log(
            '[turn/completed]',
            message.params?.turn?.status ?? ''
        );

        resolveTurnCompleted(message.params);
    }
});

async function main() {
    const timeout = setTimeout(() => {
        console.error('\nTIMEOUT: no terminó el turno en 90 segundos.');
        child.kill();
        process.exitCode = 3;
    }, 90_000);

    try {
        console.log('Starting app-server...');
        console.log('CODEX_HOME:', process.env.CODEX_HOME ?? '(default)');

        await request('initialize', {
            clientInfo: {
                name: 'codexvs_dynamic_tool_probe',
                title: 'CodexVS Dynamic Tool Probe',
                version: '0.0.1'
            },
            capabilities: {
                experimentalApi: true
            }
        });

        notify('initialized');

        console.log('Initialized.');

        const threadResult = await request('thread/start', {
            cwd: process.cwd(),
            approvalPolicy: 'never',
            sandbox: 'read-only',
            ephemeral: true,

            dynamicTools: [
                {
                    name: DYNAMIC_TOOL_NAME,
                    description:
                        'Diagnostic client-owned VS Code dynamic tool. ' +
                        'When asked to run the CodexVS dynamic-tool probe, ' +
                        'you must call this tool exactly once.',

                    inputSchema: {
                        type: 'object',

                        properties: {
                            value: {
                                type: 'string'
                            }
                        },

                        required: ['value'],
                        additionalProperties: false
                    }
                }
            ]
        });

        const threadId = threadResult?.thread?.id;

        if (!threadId) {
            throw new Error(
                `thread/start did not return a thread id: ${JSON.stringify(
                    threadResult
                )}`
            );
        }

        console.log('Thread:', threadId);

        await request('turn/start', {
            threadId,

            input: [
                {
                    type: 'text',

                    text:
                        'Run the CodexVS dynamic-tool probe now. ' +
                        `You MUST call ${DYNAMIC_TOOL_NAME} exactly once ` +
                        'with value "ping". ' +
                        'Do not use any other tool. ' +
                        `Do not answer before calling ${DYNAMIC_TOOL_NAME}.`
                }
            ]
        });

        await turnCompleted;

        console.log('\n=============================');

        if (sawDynamicToolCall) {
            console.log('RESULT: PASS');
            console.log('app-server emitted item/tool/call.');
        } else {
            console.log('RESULT: FAIL');
            console.log(
                'app-server completed the turn without item/tool/call.'
            );
        }

        console.log('=============================\n');
    } catch (error) {
        console.error('\nPROBE ERROR');
        console.error(error);
        process.exitCode = 1;
    } finally {
        clearTimeout(timeout);

        try {
            child.stdin.end();
        } catch {
            // ignore
        }

        setTimeout(() => {
            child.kill();
        }, 500);
    }
}

main();