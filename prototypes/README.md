# Prototype contract

Each prototype is an independent static page under `prototypes/<slug>/`. The three reserved directories and card orders are:

| Slug | Card order |
| --- | ---: |
| `before-midnight` | 1 |
| `safe-passage` | 2 |
| `latch` | 3 |

## Required files

```text
prototypes/<slug>/
|-- index.html
|-- game.js
|-- card.json
|-- state.js       # optional, recommended for deterministic game state
```

- `index.html` is a self-contained, mobile-first game page with relative asset paths and a viewport meta tag.
- `game.js` imports `createInputController` from `../../shared/input.js`. Keep game-state transitions separate from rendering where practical.
- `card.json` follows the one-line schema in the root README. Its positive integer `order` must be unique; the build infers `slug` from the directory.
- Local CSS and original local assets may be added inside the prototype directory. Do not add third-party assets.

## Play and accessibility requirements

- Touch/pointer and keyboard controls must have equivalent gameplay outcomes.
- Interactive targets are at least 44 by 44 CSS pixels and keyboard focus is clearly visible.
- Instructions name both control paths. Pause or safely clear held input when the page is backgrounded or loses focus.
- Audio starts muted, has an obvious mute control if present, and is never required to understand or complete play.
- Honor `prefers-reduced-motion`; reduced motion must not remove gameplay information.
- Provide deterministic presets or seeds so tests can reproduce timing, scoring, and end states.
- The post-game surface is a result card with a retry action only. Do not add sharing, signup, leaderboard, or retention funnels.

## Technical boundaries

- Stay within 20 KiB uncompressed total and 8 KiB JavaScript for the complete prototype directory. Run `npm run build && npm run budget` and report exact measurements if the limit blocks a legible game.
- No backend, accounts, analytics, tracking, persistence dependency, network dependency, or third-party service.
- No third-party marks, branded art, copied assets, or external asset URLs.
- Add deterministic unit coverage for state rules and mobile browser coverage for the playable path, retry, input parity, focus, reduced motion, and accessibility.
