# In-game feedback ("Something wrong?")

NOW-201: every game and its results screen carries a small, always-reachable
**Feedback** control, placed in the page header — outside the play/touch
surface — so it never interferes with active controls (this was prompted by
an iPhone control-interference report that could only be filed because
someone was standing next to the player). Opening it pauses play. It is
text-first: tap, type, send. No account, no email, and the player never
leaves the game.

This document is the delivery contract for the collector this control talks
to. **Text is shipped in this change; the collector described below is not
implemented in this repository.** Like the analytics collector documented in
`docs/ANALYTICS.md`, the receiving service is infrastructure IAL deploys and
operates on existing capacity — the game image stays a static nginx artifact
and does not gain a backend of its own. Until the collector exists, submits
in DEV/PROD hit an unmatched route and the client's own network-error/retry
path handles it (the draft is never lost — see below); this is a real,
first-class blocker on the "real submit → persisted receipt" acceptance
criterion, not a design gap in the browser code.

## What ships in this change (application code)

- A small header-level "Feedback" button on Before Midnight, Latch!, and Safe
  Passage — outside `#game-panel`/`#game`, reachable on both the live game and
  its results screen because the header persists across both.
- Opening the dialog dispatches a `nownow-feedback` event; each game's own
  pause primitive (existing `visibilitychange` handling for Latch! and Safe
  Passage, a new pause/resume for Before Midnight) freezes its clock while
  the dialog is open and resumes it on close, adjusting for the paused
  duration. No round or run time is lost or unfairly consumed by typing.
- Text-only submission: a `<textarea>` (1000-character limit), an optional
  "include browser & screen details" checkbox (unchecked content never sent
  unless the player opts in), Send/Cancel, and an `aria-live` status region.
- A network error (or non-2xx response) keeps the typed draft in place and
  re-enables Send after a short client-side cooldown — nothing is lost, no
  retype required. The draft is **not** written to `localStorage` or
  `sessionStorage`; it only lives in the open dialog for the current page
  session, which is both simpler and avoids adding a new place free-text
  feedback could linger in the browser.
- Accessibility: a native `<dialog>` (focus management, Escape-to-dismiss,
  inert background), labelled form controls, 44px+ tap targets, and a
  post-open `axe-core` scan with zero violations (`tests/browser/feedback.spec.mjs`).
- Voice notes are **explicitly out of scope for this change** — text ships
  first per the issue's own instruction that voice must not block it. A
  follow-up will add: user-initiated recording permission (never
  always-on mic), stop/playback/delete before sending, a duration and file-size
  limit, and a clear-text fallback if recording is denied or unsupported.

## Request contract

```
POST /feedback/submit
Content-Type: application/json
```

```json
{
  "message": "The pump control felt unresponsive on iPhone.",
  "path": "/games/before-midnight/",
  "context": "before-midnight@1",
  "tech": {
    "ua": "Mozilla/5.0 (...)",
    "viewport": "390x844",
    "lang": "en-ZA"
  }
}
```

- `message` — required, 1–1000 characters, trimmed. Free text only.
- `path` — the canonical in-game route the player was on.
- `context` — a short, hardcoded `game@version` tag from a
  `<meta name="nownow-feedback-context">` tag per game (`before-midnight@1`,
  `latch@1`, `safe-passage@1`); bumped by hand when a game's feedback-relevant
  behaviour changes meaningfully. It is not a build SHA and carries no
  identity.
- `tech` — present only if the player opted in. Browser `User-Agent`,
  viewport size, and language — the same class of data every request already
  exposes to the server, just disclosed and optional here rather than
  silently logged.
- Request uses `credentials: "omit"` and `referrerPolicy: "no-referrer"`, the
  same posture as `shared/analytics.js`. No cookies, no analytics identifier,
  no query string beyond the JSON body.

**Never included:** name, email, account/session identifiers, exact
geolocation, screenshots (automatic or otherwise), clipboard contents, or any
value not listed above.

## Response contract

- `200` with `{"id": "<short opaque string>"}` — the client shows
  `Thanks — received (ref <id>).` The `id` only needs to be short and unique
  enough for the team to find the item again; it is not shown or used as an
  identifier for the player.
- Any non-2xx status, a malformed body, or a network failure — the client
  treats it as a delivery failure: it shows a retry prompt and keeps the
  draft untouched.

## Required collector behaviour (IAL infrastructure, not built here)

Reusing the same posture already established for the analytics collector in
`docs/ANALYTICS.md`:

1. **Real, monitored destination.** Persist each submission and surface it as
   a task/item in a queue an actual team member owns and reads — not a
   `mailto:` link, not a dead endpoint, not client-side storage. The Studio
   Lead owns feedback triage ownership per NOW-201; route or notify
   accordingly (the paused ICMS Postmaster stays paused — do not use it or
   any other channel that requires unpausing a channel the board has closed;
   use a small, IAL-operated persistence + notification path instead, the
   same shape as the GoatCounter deployment).
2. **Abuse, rate, and size controls.** Reject or throttle by source IP at the
   edge; cap body size well above 1000 characters of text plus the small
   `tech` object (e.g. 8 KB) and reject larger bodies outright; a sensible
   per-IP rate limit (e.g. no more than a handful of submissions per minute)
   returned as a normal non-2xx (the client already retries safely on any
   failure).
3. **Sanitize before storage/display.** Treat `message` and `tech.ua` as
   untrusted text: store as plain text, escape on any HTML render, strip
   control characters. Never execute or interpret it.
4. **No silent identity retention.** Do not persist source IP or additional
   fingerprinting beyond what is operationally necessary to rate-limit abuse,
   and do not retain it longer than that operational need requires — same
   privacy bar as `docs/ANALYTICS.md`'s edge-log guidance.
5. **Retention and privacy notice.** Define and document a retention window
   for stored submissions (e.g. resolved/triaged items pruned after a fixed
   period); the in-dialog copy already tells the player what is sent and
   why — keep the two in sync if either changes.
6. **Safe audio formats (future voice-note work only).** Not required for
   this text-only change; when voice notes ship, accept only a small set of
   safe, compressed formats (e.g. Opus/WebM or AAC/M4A) with an explicit
   duration and file-size ceiling, and apply the same abuse/rate/retention
   controls as text.
7. **Existing capacity, no new cost.** Deploy on IAL's existing capacity, the
   same constraint already in force for the analytics collector; stop for
   Studio Lead approval before incurring any cost.
8. **Acknowledge receipt.** Return the `200 {"id": ...}` shape above so the
   player sees a real confirmation, not a guess.

## Rollback

Revert the application commit to remove the control and stop client
submissions. If a collector has been deployed per this contract, IAL removes
the `/feedback/submit` route and stops the collector while retaining stored
submissions for the agreed retention window, mirroring the analytics
rollback in `docs/ANALYTICS.md`.
