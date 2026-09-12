# In-game feedback ("Something wrong?")

Every game and results screen carries a small, always-reachable **Feedback**
control in the page header, outside the play surface. Opening it pauses play.
The path is text-first: tap, type, send. No account, email, or navigation away
from the game is required.

The same NowNow container now serves the static game build and the
`/feedback/submit` receiver. Existing CI/CD deploys that container; there is no
separate service, manual infrastructure handoff, Pages fallback, or paid
dependency.

## Browser behaviour

- The control remains reachable during play and on results screens.
- A native `<dialog>` provides focus management, Escape dismissal, labelled
  controls, 44px+ tap targets, and an `aria-live` status region.
- The message is required, trimmed, and capped at 1000 characters.
- Browser, viewport, and language details are sent only when the player selects
  the unchecked opt-in box. No automatic screenshot or identity is collected.
- A network error or non-2xx response keeps the draft in memory and re-enables
  Send after a short cooldown. Drafts are never written to browser storage.
- Voice notes remain out of scope for this text-first delivery and do not block
  it.

## Request contract

```http
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

- `message`: required, 1-1000 characters after trimming.
- `path`: a canonical `/games/<slug>/` or `/prototypes/<slug>/` route.
- `context`: a short hardcoded `game@version` value from the page's
  `nownow-feedback-context` meta tag.
- `tech`: optional and allowlisted to `ua`, `viewport`, and `lang`.
- Requests use `credentials: "omit"` and `referrerPolicy: "no-referrer"`.

Unknown fields are rejected. Names, email, account/session identifiers,
geolocation, screenshots, clipboard data, cookies, analytics identifiers, and
query strings are never accepted or stored.

## Response contract

- `200 {"id":"<short opaque reference>"}` means the monitored queue accepted
  the item. Only then does the browser show `Thanks - received (ref <id>).`
- Invalid JSON or fields return `400`; bodies over 8 KiB return `413`; non-JSON
  requests return `415`; throttled sources return `429` with `Retry-After`.
- Missing receiver configuration returns `503`. A queue timeout or rejection
  returns `502`. Every non-2xx path preserves the player's draft for retry.

## Receiver and monitored queue

`server/feedback.mjs` validates and sanitizes the request, generates an opaque
reference, and posts one comment to the Studio Lead-owned Feedback Inbox
(`NOW-210`, issue id `7212ea0b-d8a1-4070-a46f-593258404c61`). The comment
contains only the allowlisted payload, server timestamp, and receipt reference.
The POST uses Paperclip's structured `resume: true` flag so a new item wakes the
owner even when the inbox issue was previously completed.

The receiver returns success only after Paperclip accepts the comment. Queue
messages render untrusted values as encoded plain text; control characters,
raw HTML, and raw `@` mentions cannot execute markup or trigger arbitrary agent
wakes.

The Studio Lead classifies each queue item as bug, idea, abuse/spam, or noise,
records the disposition, and creates a linked work item when action is needed.
The ICMS Postmaster remains paused and is not part of this path.

## Abuse, privacy, and retention

- The receiver accepts at most five requests per source key per minute and
  rejects a sixth with `429`. The existing trusted proxy's right-most
  `X-Forwarded-For` value is used; direct deployments can set
  `FEEDBACK_TRUST_PROXY=0` to use the socket address.
- Rate-limit keys live only in memory, are pruned after the one-minute window,
  and are never attached to queue comments. The application emits no request
  access log.
- The total request body is capped at 8 KiB. All objects and fields are
  allowlisted and length-bounded before queue delivery.
- Stored submissions are retained for at most 90 days. The Studio Lead prunes
  items after triage/resolution and in all cases by that limit.
- Delivery uses existing capacity and adds no service, account, or recurring
  cost.

## Runtime configuration

The receiver requires the automatic DEV and PROD environments to inject this
runtime configuration at deploy time:

- `FEEDBACK_PAPERCLIP_API_URL`: Paperclip base URL (with or without `/api`).
- `FEEDBACK_PAPERCLIP_API_KEY`: least-privilege queue comment credential.
- `FEEDBACK_QUEUE_ISSUE_ID`: optional destination override; defaults to the
  Feedback Inbox id above.
- `FEEDBACK_TRUST_PROXY`: defaults to trusted-proxy mode; set to `0` only when
  the container is directly exposed.

Secrets must never appear in source, logs, issue comments, or artifacts.

## Delivery and acceptance

- A merge to `main` runs `Verify static harness`, publishes the immutable image,
  and the existing automation deploys DEV at
  `https://nownow.dev.mplace.co.za/`.
- Independent QA must submit one real DEV message and match the browser receipt
  id to the new Feedback Inbox item before any production-triggering merge.
- PROD remains a deliberate, independently approved merge to `prod`; its
  existing workflow and automatic deployment are not triggered by this change.

## Rollback

Revert the application commit on the affected environment branch. Existing
CI/CD then deploys the prior application behaviour. For an urgent runtime
rollback, use the deployment system's recorded previous immutable image digest.
Do not delete stored feedback during rollback; keep it for the 90-day maximum
retention window and revoke the receiver credential if the route is retired.
