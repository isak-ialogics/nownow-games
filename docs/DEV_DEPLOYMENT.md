# NowNow Games DEV deployment

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
