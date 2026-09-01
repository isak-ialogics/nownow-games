# NowNow Games

NowNow Games is the home for small, original, mobile-first browser game prototypes. Each prototype is a self-contained static page that can be played with touch or a keyboard.

## Repository layout

- `index.html` is the prototype hub.
- `prototypes/<slug>/` contains one self-contained prototype page and its game logic.
- `shared/` contains the small input and presentation modules shared by prototypes.
- `tests/` contains deterministic unit tests and mobile browser acceptance tests.

The first harness proof is available at `prototypes/input-lab/`.

## Local verification

```sh
npm ci
npm run verify
```

The production build is emitted to `dist/`. The repository deliberately has no backend, accounts, analytics, persistence, or external game services.

## Performance budget

The static production artifact must remain at or below 60 KiB uncompressed in total, with JavaScript at or below 20 KiB. `npm run budget` measures the built files and fails when either limit is exceeded.

## Originality and license

All application source and visual design in this repository were created for NowNow Games. No third-party game concept, trademark, branded artwork, or copied game asset is included.

Copyright (c) 2026 NowNow Games. All rights reserved. See [LICENSE.md](./LICENSE.md).

