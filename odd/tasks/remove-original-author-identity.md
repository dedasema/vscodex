# Remove Original Author Identity

## Objective

Remove the original author's non-mandatory identity from the fork's current source and reachable Git history while preserving the user's existing commit identity and all legally required MIT and third-party attribution.

## Decisions

- Cleanup target: the original author identity only; preserve the user's current author and committer identity.
- Repository topology: keep `dedasema/vscodex` as a GitHub fork, accepting that GitHub will continue to display its upstream parent.
- Extension identity: rebrand from `merceralex397-collab.codexvs` to `dedasema.codexvs`.
- Marketplace readiness: prepare the code now even though the public `dedasema` Marketplace publisher does not yet exist.
- Replacement identity for rewritten original Git metadata: `CodexVS Contributor <noreply@users.noreply.github.com>`.

## Constraints

- Preserve `LICENSE` verbatim, including `Copyright (c) 2026 merceralex397-collab`, because the MIT license requires the copyright and permission notices to remain.
- Preserve `THIRD_PARTY_NOTICES.md` and generated dependency attribution verbatim.
- Preserve the user's existing Git author and committer identity.
- Preserve the unrelated unstaged `.gitignore` residue without staging, resetting, checking out, or overwriting it.
- Do not delete or detach the GitHub fork.
- Do not rewrite history, tags, or remote refs until the user approves the exact destructive plan and rollback boundary.
- Publication as `dedasema.codexvs` remains blocked until the user creates and controls the `dedasema` Visual Studio Marketplace publisher.

## Tasks

- [x] **OAI-1 — Rebrand current source metadata**
  - Replaced removable upstream author, owner, repository, support, release, and Marketplace metadata with fork-local `dedasema` values.
  - Kept the MIT license and third-party notices byte-for-byte unchanged.
  - Package security now enforces the new publisher and fork URLs and pins the CRLF-normalized legal license SHA-256 without duplicating its original author literal outside `LICENSE`.
  - Commit: `e36f5c8` (`chore(package): rebrand fork metadata`); exact committed-range native review approved and acknowledged under `review-e269ceb8455adf67`.
- [x] **OAI-2 — Verify the rebranded source and package**
  - Independent verifier passed syntax, `npm run check`, `check:security`, `check:notices`, unit (10/10), smoke (1/1), pre-release VSIX packaging (10 files, 1.01 MB), and `check:package`.
  - The source and packaged manifests identify `dedasema.codexvs`; existing command/settings/provider namespaces remain `codexvs`.
  - `LICENSE` and `THIRD_PARTY_NOTICES.md` are unchanged, and tracked-source search finds the original identity only in `LICENSE:3`.
  - Publishing remains blocked until the `dedasema` Marketplace publisher exists. The fork has no release/tag for the README download link, and fork Issues are disabled; remote link availability and security-advisory enablement were not independently verified.
- [ ] **OAI-3 — Authorize and execute history cleanup**
  - Build an access-controlled mirror backup and old-to-new commit map outside the repository.
  - Rewrite only the original author's commit/tag identity to `CodexVS Contributor <noreply@users.noreply.github.com>`.
  - Rewrite removable historical blob occurrences to the fork-local identity while preserving `LICENSE` and third-party notices in every rewritten tree.
  - Force-update only the exact affected fork refs after explicit user authorization; never mutate upstream.
- [ ] **OAI-4 — Verify remote cleanup boundaries**
  - Confirm current files and reachable rewritten objects contain the original identity only in legally required notices.
  - Confirm the user's commit identity remains unchanged.
  - Confirm PR #1, Actions metadata, fork-parent attribution, caches, and upstream objects that Git rewriting cannot erase.
  - Record the final refs, review evidence, residual unavoidable attribution, and Marketplace publisher blocker.

## Audit Evidence

- Current reachable history contains 12 commits: one original-author root commit and 11 user-authored commits.
- All commits are unsigned.
- The local annotated `v0.2.1-pre` tag carries the original identity; the fork currently has no remote tag.
- Current tracked source contains no user full name or personal email; those occur in Git commit metadata and PR commit metadata only.
- The original identity occurs in current package metadata, project links, CODEOWNERS, release documentation, security acceptance, README copyright text, and the mandatory MIT license notice.
- The fork has no releases, remote tags, package artifacts, rulesets, or protected branches.
- PR #1 is open and contains one Copilot review tied to the current pre-rewrite head.
- GitHub will continue to expose the upstream parent while the repository remains a fork.

## Next Step

Design and present the exact backup, root-commit/tag rewrite, PR #1 impact, and fork-ref force-push plan. Do not run any history mutation until the user explicitly approves that destructive boundary.