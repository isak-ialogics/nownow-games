# NowNow Games delivery

## Branch mapping

| Environment | Trigger branch | Public route |
| --- | --- | --- |
| DEV | `main` | `https://nownow.dev.mplace.co.za/` |
| PROD | Manual exact-digest promotion | `https://nownowgames.co.za/` |

`Verify static harness` runs on pushes and pull requests for both branches. A
successful `main` push triggers DEV publication:

- `.github/workflows/deploy-dev.yml` publishes the immutable commit tag and the
  moving `dev` tag after a green `main` run.
- `.github/workflows/deploy-prod.yml` is manual-only and promotes one pinned,
  independently accepted manifest to the moving `prod` alias without rebuilding.

The existing environment automation watches those GHCR packages and performs
the matching deployment. Routine DEV delivery therefore needs no manual
deployment gate or infrastructure handoff. PROD requires an authorised manual
dispatch with the exact accepted digest. A `prod` branch push no longer builds
or publishes an image. GitHub Pages is not an environment or fallback.

## Promotion policy

DEV is automatic after machine checks pass. Independent QA then validates the
deployed DEV artifact. PROD promotion is permitted only after independent DEV QA
and release approval identify the accepted source SHA and image digest. The
promotion copies that digest to `:prod`; neither a green build nor a branch move
promotes itself to production.

## PROD exact-manifest promotion

The release pinned by NOW-255 has these identities:

- accepted source commit: `d26c3414391546780726bb9ec8f9dec123f26fdd`;
- accepted OCI digest: `sha256:729dd520ba422a65e69a7c70aaf92addb53e379bdfed4e468d2abb63e62876c0`;
- PROD branch commit: `5f4d1ad3e289cbb787ac613eb65aeb3998617fa4`;
- prior PROD digest: `sha256:20d3055817bbbd2b83abbd5ca462d869b105c3e176da4e669ad34eb862fcd3d1`;
- rollback PROD commit: `2c5d2fc73e94c3ccaf9638c402b7b90588b5bd64`.

Before dispatch, the authorised release operator captures the current registry
alias and production runtime on the PROD Swarm manager:

```sh
docker buildx imagetools inspect ghcr.io/isak-ialogics/nownow-games:prod --format '{{.Manifest.Digest}}'
docker service inspect --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' prod-nownow-games_static
docker service ls --filter name=prod-nownow-games_static --format '{{.Replicas}}'
```

Supply those values as `expected_previous_digest`, `previous_runtime_identity`,
and `previous_runtime_replicas`. The immutable approved digest must be supplied
as `approved_digest`. Dispatch first with `execute=false`; that performs registry
preflight and a manifest-copy dry run only. After release approval, an
authorised owner may dispatch with `execute=true`. The script rejects any digest
other than the repository-pinned approval, rejects non-steady prior runtime
state, records a redacted receipt before mutation, and verifies that `:prod`
resolves to the approved digest afterward.

Promotion uses `docker buildx imagetools create --prefer-index=false` with one
digest-pinned source. It invokes no Dockerfile build path. The complete
secret-bearing job is bound to the GitHub `production` environment, whose
deployment branch policy permits only `main`, and the workflow also fails closed
with a job-level `main` ref gate. The environment-scoped `IAL_GHCR_TOKEN` is
therefore unavailable to off-`main` dispatches before checkout, login, or any
registry access. The job token is limited to `contents: read`, and the workflow
prints no credential.

The private GHCR package is user-owned and has no linked repository, so the
repository-scoped `GITHUB_TOKEN` used by the first preflight could authenticate
but failed closed with `permission_denied: read_package`. Review correction
branches with static and focused tests, merge through the normal controls, and
then run `execute=false` from merged `main` to prove the environment-scoped
credential can perform registry preflight without mutation. The legacy
repository-scoped `IAL_GHCR_TOKEN` remains only until that merged-main validation
succeeds and its legitimate IAL owner removes it. Never inject the write-capable
secret into branch-controlled workflow code. `execute=true` remains a separately
approved manual action.
The checked-in fixture receipt is
[`evidence/now-255/promotion-fixture-receipt.json`](./evidence/now-255/promotion-fixture-receipt.json).

## Feedback receiver configuration

The same application container serves the static games and `/feedback/submit`.
The automatic environment must supply `FEEDBACK_QUEUE_WEBHOOK_URL` and
`FEEDBACK_QUEUE_WEBHOOK_SECRET` from the target-company HMAC routine trigger;
source and CI artifacts contain neither value. This trigger is scoped to create
one Studio Lead-owned queue child under the Feedback Inbox and is not a
Paperclip agent or board credential. See [`FEEDBACK.md`](./FEEDBACK.md) for the
exact target-company setup request, validation, privacy, and live acceptance.

`deploy-dev.yml` only publishes the verified image; it does not bind runtime
configuration. Do not mint the one-time trigger secret until the hosting
control plane identifies both (1) its secure write path for the
`dev-nownow-games_static` service and (2) the actor authorised to use that path.
GitHub repository secrets and Paperclip execution-environment secrets are not
substitutes unless the deployment owner proves that the running service
consumes them. The inspected configuration currently contains no such link.

## Verification evidence

For every release record:

1. source branch and commit SHA;
2. successful verification and publish workflow runs;
3. immutable GHCR digest;
4. public route and container health;
5. change-specific live smoke evidence.

For feedback, DEV acceptance additionally requires one real anonymous submit,
the browser receipt id, and a matching readable child item in the Studio Lead
queue.

## Rollback

The deployment system preserves the previous immutable tag-and-digest reference.
For an urgent DEV rollback, use the existing rollback operation:

```sh
/opt/ial-deploy/deploy.sh nownow-games --env dev --rollback
```

After rollback, verify the service replica and container health, public route,
and affected feature. A normal corrective rollback may instead revert the
application commit on the environment branch and use the same automatic CI/CD
path. Never substitute Pages or rebuild an unverified ref.

For PROD, use the saved promotion receipt on the PROD Swarm manager:

```sh
node scripts/prod-oci-release.mjs rollback --receipt prod-promotion-receipt.json --execute
```

The rollback command has a fixed, tested order: restore the prior manifest to
the `:prod` alias; verify that alias; invoke
`/opt/ial-deploy/deploy.sh nownow-games --env prod --rollback`; then verify
the alias again and require the service runtime digest plus replicas to match
the captured steady state. If any equality or steady-state check fails, stop and
escalate to IAL; do not rebuild, advance another tag, or retry promotion.
