# DEV delivery policy — board-authorised amendment

**Status:** Active
**Authorised by:** Board (Isak), NOW-187 — "Board directive: automatic DEV delivery;
verify the deployed product, not manual PR gates."
**Effective:** 2026-09-09
**Scope:** DEV environment only. Production is explicitly out of scope.

This document is the visible governance record for the change described below.
It amends how routine DEV delivery is *governed*; it does not edit or override the
studio's founding authority documents (`SOUL.md`, `AGENTS.md`, `HEARTBEAT.md`,
`TOOLS.md`), which remain in force. Where this policy and the founding documents
both speak to DEV delivery, this board-authorised amendment governs.

## What changed

Before this amendment, a routine DEV release required a human confirmation gate:
the Game Engineer raised a `request_confirmation` ("Approve merge-gated DEV
release") and merge/deploy waited for the board (Isak) or Hermes to approve each
PR individually.

The board has removed that per-PR human approval gate for **routine DEV delivery**.

### Now in force (DEV only)

1. **Machine checks are the gate.** A change merges and deploys to DEV
   automatically once the automated checks are green — `Verify static harness`
   (static + unit + build + budget + mobile/a11y e2e) and the container smoke
   coverage in CI. No human, board, or Hermes approval is required to merge or
   deploy a routine DEV change.
2. **Failed CI does not deploy.** `Publish DEV image` runs only on a successful
   `Verify static harness` (`workflow_run` + `conclusion == 'success'`). A red
   pipeline never publishes or deploys.
3. **PRs are traceability artifacts, not approval queues.** PRs remain the record
   of what changed and why. They are not held open waiting for a human sign-off.
   The owner merges as soon as checks are green.
4. **QA follows deployment.** Independent QA is exercised against the *deployed
   DEV artifact* (real interactions, mobile, SEO, console), not re-run as a
   pre-merge line-by-line gate. Existing exact-head QA (e.g. NOW-93) is evidence;
   it is not a reason to re-run a duplicate pre-merge gate (e.g. NOW-90).
5. **Failed DEV health stops or rolls back — bounded.** If post-deploy health
   fails, stop or roll back per `docs/DEV_DEPLOYMENT.md` (single bounded action),
   and record the failure as an actionable task. No unbounded recovery loop.
6. **Hermes does not implement, merge, or deploy.**

### Explicitly unchanged

- **Production is not affected.** Production promotion still requires the full
  controls: independent production acceptance, privacy/security/rights/spend
  review, and the `prod`-gated pipeline. `deploy-prod.yml` runs only on the
  `prod` branch. A `main` merge never touches production.
- Automated **CI / security / build** checks are retained in full.
- The ICMS **Postmaster stays paused**; nothing here un-pauses it. The DEV
  container path publishes to GHCR and IAL DevOps automation deploys from the
  GHCR `:dev` tag — it does not depend on an ICMS message per release.
- Secrets are never placed in issues, comments, artifacts, source, or logs.

## Who owns what

| Step | Owner |
| --- | --- |
| Product code + PR | Game Engineer |
| Merge when green (no human approval) | Owner of the change (routine DEV) |
| Container build + GHCR publish | GitHub Actions (`Publish DEV image`) |
| DEV host deploy from GHCR `:dev` | IAL DevOps automation |
| Post-deploy independent QA on the deployed artifact | QA & Release Reviewer |
| Production promotion + its gates | Studio Lead + board controls (unchanged) |

## Rollback

DEV rollback procedure is unchanged and documented in `docs/DEV_DEPLOYMENT.md`.
