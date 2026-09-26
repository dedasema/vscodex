const SENSITIVE_CHILD_ENVIRONMENT_VARIABLES = new Set([
    'OPENAI_API_KEY',
    'CODEX_API_KEY',
    'CODEX_ACCESS_TOKEN'
]);

export function sanitizeProbeChildEnvironment(environment) {
    return Object.fromEntries(
        Object.entries(environment).filter(
            ([key]) =>
                !SENSITIVE_CHILD_ENVIRONMENT_VARIABLES.has(
                    key.toUpperCase()
                )
        )
    );
}

export function reportDynamicToolProbeResult(
    sawDynamicToolCall,
    { log = console.log, processRef = process } = {}
) {
    log('\n=============================');

    if (sawDynamicToolCall) {
        log('RESULT: PASS');
        log('app-server emitted item/tool/call.');
    } else {
        log('RESULT: FAIL');
        log('app-server completed the turn without item/tool/call.');
        processRef.exitCode = 1;
    }

    log('=============================\n');
}
