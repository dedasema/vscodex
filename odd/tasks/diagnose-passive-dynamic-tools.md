# Diagnose Passive Dynamic Tools

## Objective

Identify the first production app-server setting that prevents CodexVS from receiving an `item/tool/call` for a caller-supplied VS Code dynamic tool.

## Problem and Why

The full CodexVS flow receives VS Code's `create_file` definition and includes it in `thread/start.dynamicTools`, but the model completes without calling it. A direct app-server probe has demonstrated dynamic-tool support, so the remaining gap must be isolated without enabling Codex-owned capabilities or weakening the passive-provider boundary.

The current probe also contains a declared-tool/prompt-name mismatch. That mismatch must be removed before process arguments can be evaluated reliably.

## Scope

- Maintain a deterministic direct dynamic-tool probe.
- Reproduce the static production `APP_SERVER_ARGUMENTS` in that probe.
- Record the observed PASS/FAIL boundary and choose the next smallest diagnostic difference.
- Remove temporary production experiments only after the causal difference is identified.

## Constraints

- VS Code remains the owner of tools, permissions, file changes, commands, approvals, and subagents.
- Do not enable Codex built-in shell, filesystem, MCP, plugin, skill, web, or collaboration capabilities as a workaround.
- Preserve the unrelated local `.gitignore` modification and never stage it with this work.
- Stage only explicit task files.
- TDD mode: off; no repository or session configuration enables it. Use focused syntax and live integration checks instead.
- Delivery strategy: `ask-on-risk`.
- Forecast: approximately 260 authored changed lines, excluding generated artifacts.
- Running authored change count: 171 lines through PDT-2.

## Tasks

- [x] **PDT-1 — Establish passive-argv probe parity**
  - Route: inline direct after delegated read-only mapping; one mechanical script surface.
  - Fixed the dynamic-tool name mismatch and launched with the exact static production `APP_SERVER_ARGUMENTS`.
  - Verification: syntax passed; live probe completed with `RESULT: FAIL` and no `item/tool/call`.
  - Commit: `0c1f2cc` (`test(app-server): reproduce passive dynamic tool failure`).
  - Native review: approved and acknowledged under lineage `review-fc6069d4f34b342a`.
- [x] **PDT-2 — Isolate the next production difference**
  - Route: delegated bounded writer after the long-session trigger.
  - Added a validated diagnostic-only `--omit-disable=<feature>` probe option while preserving the default production argv.
  - Verification: omitting only `--disable code_mode_host` changed the probe from FAIL to PASS and emitted `item/tool/call`.
  - Commit: `96a8b1e` (`test(app-server): isolate code mode host flag`).
  - Native review: approved and acknowledged under lineage `review-92ebf0bbd70b5f5f`.
- [ ] **PDT-3 — Validate the safe code-mode host boundary**
  - Route: delegate bounded preparation and implementation.
  - Reproduce the production thread config while omitting only the process-level `--disable code_mode_host` flag.
  - Prove whether `features.code_mode_host: false` preserves dynamic tool calls without exposing Codex-owned code-mode capabilities.
  - Record focused verification and commit identity.
- [ ] **PDT-4 — Normalize temporary diagnostics**
  - Route: delegated writer because production normalization will touch multiple non-trivial files.
  - Apply the smallest architecture-compliant production fix supported by PDT-3 evidence.
  - Remove the `create_file`-only filter and raw-alias exception after the cause is established.
  - Keep only diagnostics or probes that provide durable development value.
  - Run the applicable project checks and record the final commit identity.

## Acceptance Criteria

- The direct probe requests exactly the dynamic tool it declares.
- The probe can reproduce production passive process arguments without enabling built-in capabilities.
- Evidence identifies the first known PASS/FAIL boundary or narrows the remaining difference explicitly.
- Temporary production behavior does not remain as the final solution.
- `.gitignore` remains unstaged and unchanged by this feature.

## Progress and Evidence

- Read-only mapping confirmed production arguments in `src/appServer/appServerProcess.ts` and the mismatch in `scripts/probe-dynamic-tool.mjs`.
- Incident diagnosis identified the existing `.gitignore` delta as local Pi runtime residue; it is preserved outside this work.
- PDT-1 implementation now shares one dynamic-tool name between declaration and prompt and matches the static production `APP_SERVER_ARGUMENTS` exactly.
- `node --check scripts/probe-dynamic-tool.mjs`: passed in delegated verification and in the parent spot check.
- `node scripts/probe-dynamic-tool.mjs`: completed with `RESULT: FAIL`; app-server emitted no `item/tool/call`. Stderr also reported an MCP HTTP 404 and disabled code-mode host, without an authentication failure. Causality remains unproven.
- PDT-1 independent verification passed code and argument-parity checks; it was initially partial only because task bookkeeping had not yet recorded completion.
- PDT-1 commit `0c1f2cc` was approved and acknowledged by native review lineage `review-fc6069d4f34b342a`.
- PDT-2 independently reproduced a dynamic tool call only when `--disable code_mode_host` was omitted; the default full passive argv remains unchanged.
- PDT-2 commit `96a8b1e` was approved and acknowledged by native review lineage `review-92ebf0bbd70b5f5f`.
- Current reviewed boundary: `96a8b1e`.

## Next Step

Reproduce the production `thread/start` passive config with process-level `code_mode_host` omission to determine whether the per-thread false setting is a safe boundary.
