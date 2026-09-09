# NowNow Games DEV deployment

## Delivery policy (board-authorised, NOW-187)

Routine DEV merges and deployments are **automatic when machine checks are
green** — no human, board, or Hermes approval gate. `Verify static harness`
(and the container smoke coverage in CI) is the gate; a red pipeline never
publishes or deploys. PRs are traceability artifacts, not approval queues.
Independent QA runs against the *deployed* DEV artifact, not as a pre-merge
line-by-line gate. Failed DEV health triggers a single bounded stop/rollback
(below), not a recovery loop. Production is unaffected: `deploy-prod.yml` is
gated on `prod` only. Full rationale and governance record:
[`docs/governance/dev-delivery-policy.md`](./governance/dev-delivery-policy.md).

## Pipeline

The DEV workflow runs only after `Verify static harness` succeeds on `main`.
It publishes `ghcr.io/isak-ialogics/nownow-games:<commit-sha>`, resolves the
GHCR manifest digest, and deploys the combined tag-and-digest reference through
`/opt/ial-deploy/deploy.sh nownow-games --env dev` on the DEV Swarm runner.

`workflow_dispatch` is for recovery only: select a ref that has already passed
verification. Do not use floating tags, Watchtower, or polling automation.

The deployment verifies `dev-nownow-games_static` is `1/1`, that its container
health check is healthy, and that the internal Traefik HTTPS route returns 200.

## Manual rollback

The deployer preserves the previous tag-and-digest image reference. Roll DEV
back with:

```sh
/opt/ial-deploy/deploy.sh nownow-games --env dev --rollback
```

After a rollback, recheck the Swarm replicas, container health, and
`https://nownow.dev.mplace.co.za/` HTTP status.
