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

- [ ] **OAI-1 — Rebrand current source metadata**
  - Replace removable upstream author, owner, repository, support, release, and Marketplace metadata with fork-local `dedasema` values.
  - Keep the MIT license and third-party notices unchanged.
  - Update package-security acceptance so it enforces the new publisher and fork URLs while still validating the exact legal license content without duplicating the original author name outside `LICENSE`.
  - Add or update deterministic checks for the rebranded metadata.
  - Commit as a focused conventional work unit without `.gitignore`.
- [ ] **OAI-2 — Verify the rebranded source and package**
  - Run syntax/type, security, notices, unit, smoke, packaging, and package-content checks applicable to metadata and distribution changes.
  - Confirm the built VSIX identifies as `dedasema.codexvs` and includes unchanged legal notices.
  - Record any environmental or Marketplace blockers explicitly.
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

Implement OAI-1 through a bounded writer, then independently verify the current-tree rebrand before proposing any history rewrite or force-push.