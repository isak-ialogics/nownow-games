# One Lucky Bloom itch.io release

This directory records the portal-specific release contract. The package is a
deterministic derivative of the owned game files at source commit
`48e24d237a1adc56fb29bdfd37bc82acf78680f3`; the packaging script records a
SHA-256 for every input in the ZIP's `source.json` marker.

The portal transform is intentionally narrow:

- retain the deterministic game state, local settings, keyboard/touch input,
  reduced-motion option, pause/recovery, sound toggle, retry, and share action;
- make all runtime imports package-relative;
- tighten the five-lane grid at 320 px so every lane remains a 48 px target;
- remove NowNow analytics, feedback, discovery links, canonical/social metadata,
  and the owned-site URL from shared result text;
- add `portal=itchio`, version, source commit, and `telemetry=none` markers;
- include no service worker, credentials, third-party library, or remote asset.

## Reproduce and verify

From the repository root with Node.js 24 and dependencies installed:

```sh
npm run portal:package
npm run portal:check
```

`portal:package` writes the versioned ZIP, SHA-256 sidecar, and file inventory to
`releases/one-lucky-bloom/`. It also expands the exact runtime files to
`dist/itchio/one-lucky-bloom/` for browser acceptance. ZIP entry order,
timestamps, attributes, and compression method are fixed, so identical source
inputs produce identical bytes on Windows and Linux.

Independent checksum commands:

```sh
sha256sum releases/one-lucky-bloom/one-lucky-bloom-itchio-1.0.0.zip
```

```powershell
Get-FileHash releases/one-lucky-bloom/one-lucky-bloom-itchio-1.0.0.zip -Algorithm SHA256
```

Clean-room inspection can use any empty directory and a local static server:

```powershell
Expand-Archive releases/one-lucky-bloom/one-lucky-bloom-itchio-1.0.0.zip -DestinationPath $env:TEMP\one-lucky-bloom-clean
python -m http.server 8080 --directory $env:TEMP\one-lucky-bloom-clean
```

Open `http://127.0.0.1:8080/`, then deny network access after the initial load.
The automated browser acceptance performs the same offline-after-load run,
including result and retry, with storage APIs throwing.

## Budgets and portal limits

The repository enforces a stricter package budget than the portal limits:

- at most 10 files;
- at most 64 KiB total extracted content;
- at most 32 KiB for any file;
- at most 100 KiB for the ZIP;
- at most 240 UTF-8 bytes in any entry path.

The exact measured inventory and checksum are in
`releases/one-lucky-bloom/one-lucky-bloom-itchio-1.0.0.inventory.txt` and the
matching `.sha256` sidecar.
