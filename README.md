# NowNow Games

NowNow Games is the home for small, original, mobile-first browser game prototypes. Each prototype is a self-contained static page that can be played with touch or a keyboard.

## Repository layout

- `index.html` is the prototype hub template.
- `prototypes/<slug>/` contains one self-contained prototype page, game logic, and card metadata.
- `shared/` contains the small input and presentation modules shared by prototypes.
- `tests/` contains deterministic unit tests and mobile browser acceptance tests.

The retired input-lab proof established touch and keyboard parity; reusable input coverage remains in `tests/unit/input.test.mjs`.

## Add a prototype card

The production build discovers every immediate prototype directory, reads its `card.json`, and injects the sorted cards and visible count into the hub. Prototype branches therefore add only files under their own slug and do not edit a shared registry.

One-line add-a-card pattern (the slug comes from the directory name):

```json
{"order":1,"title":"Game title","kicker":"One-minute game","description":"A short, original hook.","features":["Touch + keyboard","Deterministic play"]}
```

See [`prototypes/README.md`](./prototypes/README.md) for the full prototype contract and the reserved slug/order assignments.

## Local verification

```sh
npm ci
npm run verify
```

The production build is emitted to `dist/`. The game remains a static app with no accounts or external game services. Its small cookieless analytics client sends only aggregate same-origin counters; see [`docs/ANALYTICS.md`](./docs/ANALYTICS.md) for the event contract, privacy boundary, IAL route, and rollback.

## Performance budget

`npm run budget` measures and prints each production bucket independently:

| Bucket | Total uncompressed | JavaScript |
| --- | ---: | ---: |
| Each `prototypes/<slug>/` directory | <= 20 KiB | <= 8 KiB |
| `shared/` | <= 14 KiB | <= 7 KiB |
| Hub `index.html` | <= 7 KiB | n/a |

Any single breach exits non-zero. This per-page model keeps the warm-cache target of interactive in under two seconds on a mid-range phone without making unrelated prototype payloads consume one global allowance. If a legible game cannot meet its bucket, report the measured total and JavaScript sizes before proposing a limit change.

## Originality and license

All application source and visual design in this repository were created for NowNow Games. No third-party game concept, trademark, branded artwork, or copied game asset is included.

Copyright (c) 2026 NowNow Games. All rights reserved. See [LICENSE.md](./LICENSE.md).

## DEV container deployment and rollback

Successful `main` verification triggers the DEV deployment workflow. It publishes
`ghcr.io/isak-ialogics/nownow-games:<commit-sha>` and deploys that exact tag plus
its resolved manifest digest; floating tags and image polling are intentionally
not used. `workflow_dispatch` is retained for an explicitly selected, already
verified recovery ref.

To roll back DEV on the Swarm runner, run:

```sh
/opt/ial-deploy/deploy.sh nownow-games --env dev --rollback
```

The deployment script retains the prior tag-and-digest reference in its rollback
state. Verify `dev-nownow-games_static` is `1/1`, its container health is
`healthy`, and `https://nownow.dev.mplace.co.za/` returns HTTP 200 after either
a deployment or rollback.
