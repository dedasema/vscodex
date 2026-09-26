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
- Chain strategy: `stacked-to-main` (selected by the user after the forecast exceeded the review budget).
- Forecast: approximately 460 authored changed lines, excluding generated artifacts.
- Running authored change count: 255 lines through PDT-3; PDT-4 adds 205 scoped lines before commit.
- Planned PR slice 1 — diagnostic probe: commits `0c1f2cc`, `96a8b1e`, and `9956180`, plus their ODD bookkeeping commits.
- Planned PR slice 2 — production normalization: PDT-4 implementation and tests, independently reviewable against `main`.

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
- [x] **PDT-3 — Validate the safe code-mode host boundary**
  - Route: delegated bounded preparation and implementation.
  - Reproduced the static production thread config while omitting only the process-level `--disable code_mode_host` flag.
  - Verification: `features.code_mode_host: false` remained active and the probe emitted `item/tool/call`; the process-level flag, not the per-thread false setting, suppresses client dynamic tools.
  - Commit: `9956180` (`test(app-server): validate passive thread config`).
  - Native review: approved and acknowledged under lineage `review-a1a2e960c6ae3df8`.
- [x] **PDT-4 — Normalize temporary diagnostics**
  - Route: delegated writer because production normalization touches multiple non-trivial files.
  - Production commit: `f0e0bef` (`fix(app-server): restore caller dynamic tool catalog`).
  - Production native review: approved and acknowledged under lineage `review-d7798e395786da7b`.
  - Packaging correction commit: `280398f` (`fix(package): exclude local harness state`).
  - Packaging native review: approved and acknowledged under lineage `review-87d7030f7a1e893a`.
  - Focused checks, compile, host, app-server, security, notices, pre-release packaging, and package validation passed.
  - The private real-app-server check remains environmentally blocked because the isolated CodexVS home is signed out.

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
- PDT-3 preserved `features.code_mode_host: false` and the remaining passive thread config while successfully emitting the client dynamic tool call.
- PDT-3 verification is partial only for full production parity: the standalone probe intentionally retains its cwd and does not reproduce provider/model fields or runtime-discovered MCP overrides.
- PDT-3 commit `9956180` was approved and acknowledged by native review lineage `review-a1a2e960c6ae3df8`.
- The user selected `stacked-to-main` for the two planned PR slices after the forecast rose above 400 authored changed lines.
- PDT-4 removed only the process-level `code_mode_host` disable, retained per-thread `features.code_mode_host: false`, restored the full caller tool catalog and deterministic aliases, removed temporary tool-name diagnostics, and added focused boundary coverage.
- PDT-4 verification passed: `npm run check`, `npm run test:unit` (10/10), `npm run test:smoke`, probe syntax, and the live production-thread-config probe (`RESULT: PASS`).
- The live probe still emitted a non-fatal MCP HTTP 404 because the standalone script inherits cwd/environment and does not prove production MCP isolation; this caveat predates PDT-4 and production isolation remains separately tested.
- Native ambient review approved and acknowledged target `sha256:fe1dd175f017bae05a3466cca0c5625edf98b030eddeb45ee4277e15645fcc40` under lineage `review-c060212be81e9569`; that ambient target also contained the preserved unrelated `.gitignore` residue.
- Exact PDT-4 commit `f0e0bef` was independently assessed as high risk, reviewed across all four lenses, approved, and acknowledged under lineage `review-d7798e395786da7b`.
- Closure checks passed compile, extension-host, unauthenticated app-server, security, and notices. `test:real-app-server` is blocked by the signed-out private CodexVS home.
- VSIX packaging initially failed because `.atl/skill-registry.md`, `.atl/.skill-registry.cache.json`, and `odd/tasks/diagnose-passive-dynamic-tools.md` were included outside the package allowlist.
- The packaging correction adds `.atl/**` and `odd/**` to `.vscodeignore` and makes both entries mandatory in `scripts/checkPackageSecurity.mjs`.
- Independent verification passed `npm run check:security`, `npm run package:vsix -- --pre-release`, and `npm run check:package`; scoped diff is 2 files and 4 insertions, allowlist logic is unchanged, and compilation produced no tracked output differences.
- Ambient native review approved and acknowledged target `sha256:e1d09bf8a2ce8e6d35593d332e621dbc3c44f44b0323d29c4f444c49bbb6068b` under lineage `review-a118a90dd10115f2`; the ambient target also contains preserved unrelated `.gitignore` residue.
- Packaging correction commit `280398f` was independently verified and its exact committed range was approved and acknowledged under lineage `review-87d7030f7a1e893a`.
- Current exact reviewed boundary: `280398f`.

## Next Step

Push the completed feature branch, then prepare the selected stacked-to-main review slices without including the preserved `.gitignore` residue.
