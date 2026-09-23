# DEV delivery policy — board-authorised amendment

**Status:** Active
**Authorised by:** Board (Isak), NOW-187 — "Board directive: automatic DEV delivery;
verify the deployed product, not manual PR gates."
**Effective:** 2026-09-09
**Last amended:** 2026-09-09 (see the "Amendment 2026-09-09" sections below)
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
  container path publishes to GHCR and the existing environment automation
  deploys from the GHCR `:dev` tag — it does not depend on an ICMS message or
  infrastructure handoff per release.
- Secrets are never placed in issues, comments, artifacts, source, or logs.

## Who owns what

| Step | Owner |
| --- | --- |
| Product code + PR | Game Engineer |
| Merge when green (no human approval) | Owner of the change (routine DEV) |
| Container build + GHCR publish | GitHub Actions (`Publish DEV image`) |
| DEV host deploy from GHCR `:dev` | Existing CI/CD automation |
| Post-deploy independent QA on the deployed artifact | QA & Release Reviewer |
| Post-DEV release acceptance (live scrutiny of deployed DEV) | Hermes (delegated by Isak) |
| Authorise PROD promotion of the verified artifact | Hermes |
| Perform the approved promotion merge | NowNow release owner |
| Run the `prod` pipeline and deploy | Existing CI/CD automation |
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
   the NowNow release owner promotes the verified SHA to the `prod` branch,
   which triggers `deploy-prod.yml` and the existing automatic production
   deployment. **No automatic PROD on green CI alone** —
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
  and verifies; NowNow engineering executes the merge and existing CI/CD
  deploys it.
- Secrets are never placed in issues, comments, artifacts, source, or logs.

## Amendment 2026-09-09 (b) — DEV and PROD only; GitHub Pages removed from delivery

**Authorised by:** Board (Isak/Hermes), NOW-187 wake comment
`193583ca-27a8-41e1-9bfd-bf116678f09f` (2026-09-09).

GitHub Pages is **no longer an authorised environment** for NowNow Games — not
for preview, not as a fallback, and not as an acceptance target. The board has
directed that the studio deliver through **DEV and PROD only**.

### Now in force

1. **Two deployment targets, no others.** The only authorised deployment
   targets are **DEV — `https://nownow.dev.mplace.co.za/`** and **PROD —
   `https://nownowgames.co.za/`**. Canonical links, Open Graph URLs, and
   structured-data URLs already point only at the PROD origin; no `github.io`
   target remains in source.
2. **GitHub Pages is decommissioned.** The `Deploy GitHub Pages preview`
   workflow (`.github/workflows/pages.yml`) is disabled and removed, and the
   configured Pages site (`https://isak-ialogics.github.io/nownow-games/`) is
   unpublished. Historical Pages run evidence is preserved as history; it is not
   broadly deleted.
3. **No Pages fallback, ever.** If DEV fails, fix DEV and record the
   failure/blocker via Paperclip. Do **not** fall back to Pages, and do **not**
   claim success from green CI, image publication, or any preview. Pages-based
   historical QA does **not** satisfy live DEV acceptance.
4. **Verify and Publish DEV/PROD stay operational.** `Verify static harness`
   (`ci.yml`) and `Publish DEV image` / `Publish PROD image`
   (`deploy-dev.yml` / `deploy-prod.yml`) are unchanged. The
   CI → auto DEV → Hermes live acceptance → authorised `:prod` promotion →
   auto PROD → Hermes PROD verification flow (above) is the only delivery path.

### Constraints that remain (unchanged by this amendment)

- Spending, security, privacy, rights, and runtime-configuration constraints
  remain in full force; the ICMS **Postmaster stays paused**; no new platform or
  duplicate project is created.

## Rollback

DEV rollback procedure is unchanged and documented in `docs/DEV_DEPLOYMENT.md`.
