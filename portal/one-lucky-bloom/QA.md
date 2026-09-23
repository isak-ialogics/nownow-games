# One Lucky Bloom portal QA acceptance

This is the independent acceptance contract for the version 1.0.0 itch.io
candidate. Engineering preflight evidence is recorded below but is not the
independent sign-off requested by the release train.

## Must-pass criteria

- **Given** the versioned ZIP is unpacked into an empty directory, **when** its
  root is inspected, **then** `index.html` and exactly the six files recorded in
  the checked-in inventory are present with no parent directory wrapper.
- **Given** the unpacked directory is served by a plain local HTTP server,
  **when** the page finishes its initial load and all network access is denied,
  **then** a complete six-round run reaches a result and **Play again** starts a
  fresh run without a request or console error.
- **Given** localStorage get/set/remove operations throw, **when** the game is
  loaded and completed, **then** a visible non-persistence notice is shown and
  gameplay/result/retry remain available.
- **Given** a 320 × 740 touch viewport, **when** a player starts, selects a lane,
  and locks it by touch, **then** the control responds, its state is announced,
  every lane target is at least 48 px, and horizontal overflow is absent.
- **Given** a 1280 × 800 desktop viewport, **when** a player uses Arrow or number
  keys and then focuses and activates **Lock lane**, **then** selection and lock
  work without pointer input and horizontal overflow is absent.
- **Given** the game runs in a same-origin iframe or a fullscreen-sized viewport,
  **when** its available size changes between the two verified viewports, **then**
  content reflows and the controls remain reachable.
- **Given** the system requests reduced motion, **when** the portal opens, **then**
  reduced motion is active; when the in-game motion control is toggled, its
  pressed state and visible label agree.
- **Given** a portal session is observed in the browser network panel, **when**
  the game loads, runs, shares, and retries, **then** all runtime requests are for
  files in the package and no analytics, feedback, service-worker, remote asset,
  query text, or user identifier is sent.
- **Given** the player uses **Share ledger**, **when** a share target exists,
  **then** the user-initiated text reports the result and contains no owned-site
  or other URL.
- **Given** the package metadata and listing kit, **when** the candidate is
  audited, **then** version `1.0.0`, portal `itchio`, telemetry `none`, owned
  source SHA `48e24d237a1adc56fb29bdfd37bc82acf78680f3`, the ZIP checksum,
  file hashes, controls, content, support, and privacy statements agree with the
  candidate's observable behaviour.
- **Given** the cover and screenshots, **when** their pixels and declared sizes
  are reviewed, **then** they depict the shipped game, contain only original
  NowNow Games artwork/copy, and make no unshipped feature claim.

## Boundary and non-applicable areas

- **Minimum/empty state:** the first-load default has no best score and displays
  the short tutorial before play.
- **Boundary state:** five lanes, six authored rounds, automatic deadline lock,
  exact score boundaries, and a 600/600 result remain covered by owned-game unit
  tests.
- **Performance envelope:** must remain within 10 files, 64 KiB extracted,
  32 KiB per file, and 100 KiB ZIP; the page must remain interactive at 320 px.
- **Backward compatibility:** the owned-site build and routes must retain their
  existing checks; the portal uses a distinct package and does not rewrite saved
  owned-site data.
- **Concurrency:** N/A — this is a local single-player game with no shared
  mutation, server job, or multi-user state.
- **Server conflict/404 validation:** N/A — the package has no application API;
  missing static files are covered by inventory and clean-room loading.
- **Telemetry/audit:** expected portal telemetry is none. The static marker is
  inspection metadata only; portal-level aggregate reporting, if used, belongs
  to itch.io creator analytics and is not comparable to owned-site events.

## Engineering preflight

### Pass

- Deterministic package/unit check: six root files, no network API/remote URL,
  exact source hashes, reproducible ZIP.
- Mobile Chromium: framed touch select/lock and offline storage-denied full
  run/retry passed at 320 × 740 with axe-core reporting zero violations.
- Desktop Chromium: framed keyboard select/lock and offline storage-denied full
  run/retry passed at 1280 × 800 with axe-core reporting zero violations.
- Package budget: 38,287 ZIP bytes; 37,703 extracted bytes; six files.
- Media dimensions: cover 630 × 500; desktop intro 1280 × 800; mobile play and
  result screenshots 390 × 844.

### Fail

- None in engineering preflight.

### Blocked

- Independent visual/copy/rights review and DEV candidate acceptance remain for
  the QA & Release Reviewer after merge. Record evidence in the review issue;
  any failing criterion blocks release unless the owner links an explicit waiver
  and follow-up.
