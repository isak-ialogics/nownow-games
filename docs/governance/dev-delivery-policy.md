# DEV delivery policy — board-authorised amendment

**Status:** Active
**Authorised by:** Board (Isak), NOW-187 — "Board directive: automatic DEV delivery;
verify the deployed product, not manual PR gates."
**Effective:** 2026-09-09
**Last amended:** 2026-09-09 (see "Amendment 2026-09-09" below)
**Scope:** Routine DEV delivery, and the governed DEV→PROD promotion gate added
by the 2026-09-09 amendment. Production runtime remains unchanged until a
change clears that gate.

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

- **DEV automation never touches production.** No `main` merge and no green CI
  run ever promotes a change to production. Production changes only through the
  deliberate, Hermes-authorised promotion gate defined in the 2026-09-09
  amendment below. The `prod`-gated pipeline (`deploy-prod.yml` runs only on the
  `prod` branch), independent production acceptance, and the
  privacy/security/rights/spend controls all remain in force.
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
| Post-DEV release acceptance (live scrutiny of deployed DEV) | Hermes (delegated by Isak) |
| Authorise PROD promotion of the verified artifact | Hermes |
| Perform the promotion merge + run the `prod` pipeline | Studio Lead + IAL DevOps |
| Verify live PROD and notify Isak | Hermes |

## Amendment 2026-09-09 — post-DEV acceptance delegated to Hermes; governed PROD promotion

**Authorised by:** Board (Isak), NOW-187 wake comment
`f8af4bcb-83c2-4c83-90b0-d0b047c1ee3c` (2026-09-09).

The board has delegated **post-DEV release acceptance to Hermes** and defined a
governed path from a verified DEV artifact to production. This supersedes the
earlier "DEV environment only / production is explicitly out of scope /
production-unchanged" wording **only to the extent** described here; every other
control above stays in force.

### Release flow now in force

1. **Automated checks → automatic DEV.** Unchanged from the sections above: a
   routine change merges and deploys to DEV automatically when machine checks
   are green. No per-PR Isak, board, or Hermes approval to reach DEV.
2. **Hermes personally tests the deployed DEV experience.** Hermes exercises the
   *deployed* artifact — critical flows, mobile, console/network errors, and the
   change-specific acceptance criteria. Paperclip/QA evidence **supports but does
   not substitute for** this live Hermes scrutiny.
3. **PASS → Hermes authorises promotion of the exact verified artifact.**
   Promotion is pinned to the **immutable source SHA and image digest** that
   Hermes verified on DEV — the same bits, never a rebuild of "latest".
4. **Promotion is a deliberate, Hermes-authorised act.** On that authorisation
   the Studio Lead promotes the verified SHA to the `prod` branch, which triggers
   `deploy-prod.yml` to publish the `:prod` image **at the same digest**; IAL
   DevOps performs the production deploy. **No automatic PROD on green CI alone** —
   a green pipeline never promotes; only Hermes' explicit authorisation does.
5. **Hermes verifies live PROD and emails Isak** to inspect it. No further Isak
   per-release approval wait is required beyond this delegated flow.
6. **Fail or incomplete → hold and fix via Paperclip, not production.** Failed or
   incomplete tests (CI or Hermes' live DEV pass) stop promotion and route the fix
   through Paperclip. Production is unchanged until a change clears the DEV pass.

### Constraints that remain (unchanged by this amendment)

- Spending, security, privacy, rights, and runtime-configuration constraints
  remain in full force.
- The ICMS **Postmaster stays paused.**
- **Hermes does not implement, merge, or deploy** — Hermes accepts, authorises,
  and verifies; engineering/IAL execute.
- Secrets are never placed in issues, comments, artifacts, source, or logs.

## Rollback

DEV rollback procedure is unchanged and documented in `docs/DEV_DEPLOYMENT.md`.
