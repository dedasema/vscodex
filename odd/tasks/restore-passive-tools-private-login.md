# Restore Passive Tools With Private Login

## Outcome

Make caller-owned VS Code dynamic tools usable with a private CodexVS `CODEX_HOME`, without passing credential environment variables to the diagnostic child or reporting a failed probe as success. Submit a new fork-local PR only after its review and repository prerequisites are satisfied.

## Decisions and Boundaries

- Base this work on the published functional branch at `438ad57`, not the unpublished author-identity rebrand or the dirty `.gitignore` in the original worktree.
- Keep the extension-owned private `CODEX_HOME`; the user selected a separate official CodexVS sign-in instead of reading global `~/.codex` configuration or instructions.
- Codex app-server remains the sole owner of ChatGPT authentication. Do not copy, parse, or directly access credential files; do not add HTTP or API-key transport.
- Do not enable Codex-owned tools, MCP, skills, shell, filesystem, web, or collaboration. VS Code continues to own caller tool execution and permissions.
- Keep the standalone probe's documented cwd/MCP-parity limitations visible; it must sanitize credential environment variables case-insensitively and fail with a nonzero exit status when no dynamic call occurs.
- Preserve the unrelated original-worktree `.gitignore` modification and the unpublished author-identity work. No force-push, ref rewriting, or upstream delivery.
- TDD mode: off. Use focused deterministic tests plus live checks when authenticated.

## Tasks

- [x] **FPR-1 — Make the diagnostic probe fail safely**
  - The child environment now drops API-key/access-token variables case-insensitively and preserves `CODEX_HOME`; direct home-path logging was removed.
  - A completed turn without a dynamic call now prints `RESULT: FAIL` and exits 1; the successful fake-tool exchange exits 0.
  - A temporary fake Codex child exercises real subprocess exit codes and environment filtering without exposing secret values.
  - Independent verification passed probe/helper syntax, focused subprocess tests (5/5), all unit tests (15/15), and diff whitespace checks.
  - Remaining diagnostic limitations: the standalone probe inherits cwd, does not prove MCP parity, and does not validate arbitrary server-output redaction or every tool-call identity. Live authenticated validation is deferred.
  - Committed as `bd93d00` (`fix(probe): sanitize diagnostic child and signal failure`). Native review `review-5448a5bece731722` is blocked before reviewer execution: exact STATUS-issued capture bindings were rejected by the session-local route in both single and complete-group capture, with no mutation. Do not claim approval or start a replacement lineage.
- [ ] **FPR-2 — Document and verify private official sign-in**
  - Production already uses an extension-owned private home and official browser/device sign-in RPC; no process/auth transport change was needed.
  - Aligned onboarding, trust-boundary docs, package description, sign-out/status UI, backend messages, and real-probe guidance to the private-login contract.
  - A fake child crash/restart test confirms reuse of the same private `CODEX_HOME` with a fresh empty cwd; this does not prove persistence of a real authenticated CLI login.
  - Independent verification passed focused runtime test (1/1), `npm run check`, unit tests (15/15), smoke test (1/1), and scoped whitespace checks. Live login/restart check remains pending.
  - Commit pending; native review capture remains unavailable.
- [ ] **FPR-3 — Validate the functional candidate**
  - Run check, compile, unit, smoke, extension-host, app-server, notices, security, pre-release package/check, probe syntax and focused live probe.
  - Record the private-home sign-in requirement and any unauthenticated real-app-server blocker.
  - Independently verify the candidate; native review of `bd93d00` is currently blocked by a session-local capture-route mismatch and requires maintainer resolution before delivery.
- [ ] **FPR-4 — Prepare the fork-local PR**
  - Resolve the fork's disabled Issues and missing `status:approved` / `type:bug` labels before PR creation under the active branch-PR policy; request explicit user authorization for any repository-setting change or issue publication.
  - Push only a new branch without force after checks/review, then create one new PR to the fork's `main` using its template and disclose the accepted size exception.
  - Do not merge; record CI and human-review status.

## Evidence

- Closed fork PR #1 contained three Copilot findings: raw credential environment passed to the diagnostic child, `RESULT: FAIL` exiting zero, and private `CODEX_HOME` conflicting with the former shared-login documentation.
- The user chose to preserve a private home and use a separate official CodexVS sign-in; the third finding is a documentation/expectation mismatch, not authority to expose global configuration.
- The fork currently has Issues disabled and no `status:approved` or `type:*` labels; those are PR-delivery blockers, not reasons to bypass package policy.

## Next Step

Commit the verified FPR-2 docs/UI/test and task status without `.gitignore`. Then run FPR-3 full validation; keep review `review-5448a5bece731722` pending for maintainer resolution rather than minting a replacement lineage.
