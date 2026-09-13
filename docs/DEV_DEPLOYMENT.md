# NowNow Games automatic delivery

## Branch mapping

| Environment | Trigger branch | Public route |
| --- | --- | --- |
| DEV | `main` | `https://nownow.dev.mplace.co.za/` |
| PROD | `prod` | `https://nownowgames.co.za/` |

`Verify static harness` runs on pushes and pull requests for both branches. A
successful branch push triggers the corresponding publish workflow:

- `.github/workflows/deploy-dev.yml` publishes the immutable commit tag and the
  moving `dev` tag after a green `main` run.
- `.github/workflows/deploy-prod.yml` publishes the immutable commit tag and the
  moving `prod` tag after a green `prod` run.

The existing environment automation watches those GHCR packages and performs
the matching deployment. Routine DEV delivery therefore needs no manual
deployment gate or infrastructure handoff. GitHub Pages is not an environment
or fallback.

## Promotion policy

DEV is automatic after machine checks pass. Independent QA then validates the
deployed DEV artifact. A production-triggering merge to `prod` is permitted only
after independent DEV QA and release approval identify the accepted source SHA
and image digest. A green `main` build never promotes itself to production.

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
