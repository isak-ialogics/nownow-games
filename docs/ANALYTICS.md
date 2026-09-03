# Privacy-safe analytics

NowNow Games emits same-origin, cookieless aggregate counts to
`/analytics/count`. The collector contract is compatible with self-hosted
GoatCounter's stable tracking-pixel endpoint; the browser does not load code or
assets from a third party.

## Recorded measurements

- Page visits use only the canonical pathname and static document title.
- `/event/before-midnight/play-started/{new|returning}` fires when the automatic
  first run begins and when Retry starts another run.
- `/event/before-midnight/play-completed/{new|returning}` fires once when the
  seven-fill result card appears.
- `/event/before-midnight/share-triggered/{new|returning}` fires once per Share
  button activation, before Web Share or the copy-link fallback. The two share
  paths therefore cannot double-count one activation.
- `new` means no positive Before Midnight personal best existed when the page
  loaded. `returning` means the existing gameplay personal-best record did.
  Analytics creates no identifier and writes no browser storage.

Every event is a counter path, not an individual event record. A random
five-character cache buster is generated per request and discarded.

## Explicit privacy boundary

The browser sends: canonical pathname or fixed event name, static title, event
flags, and the cache buster. Requests use `credentials: omit` and
`referrerPolicy: no-referrer`.

The browser does **not** send names, email addresses, account IDs, scores,
free-form text, full URLs, query strings, referrers, screen size, cross-site
identifiers, cookies, or local-storage contents. It creates no analytics cookie
or local-storage key.

Like every web request, the edge and collector transiently receive network IP
and User-Agent headers. The required production configuration must not persist
either: disable reverse-proxy access logs for the route, leave individual
pageviews disabled, and disable GoatCounter location, browser, system, language,
screen-size, and referrer dimensions. GoatCounter documents that its default
session de-duplication keeps IP plus User-Agent only in memory for up to eight
hours and never writes them to disk. Its aggregate privacy design and
consent-notice rationale are documented at:

- https://www.goatcounter.com/help/privacy
- https://www.goatcounter.com/help/sessions
- https://www.goatcounter.com/help/gdpr

This is an engineering privacy posture, not legal advice.

## IAL deployment contract

IAL owns the collector and route because the game image remains a static nginx
artifact.

1. Deploy a pinned GoatCounter release and record its immutable image digest.
2. Use SQLite on a named persistent volume; keep individual pageviews disabled.
3. Route public `https://nownowgames.co.za/analytics/count` to the collector's
   `/count` endpoint. Do not expose analytics under a third-party browser origin.
4. Disable or redact edge access logs for `/analytics/`, apply the privacy
   settings above, and keep the dashboard authenticated.
5. Give the Studio Lead the private dashboard URL and an aggregate JSON/CSV
   export path. Never place dashboard credentials in source, logs, or issues.
6. Confirm the deployment uses existing IAL capacity with zero recurring cost,
   or stop for Studio Lead approval before incurring any cost.
7. Record one production page visit and one test event, then verify both in the
   dashboard. Remove the test counter if the dashboard supports it; otherwise
   label it clearly.

## Rollback

Revert the application commit to stop browser emission, and have IAL remove the
`/analytics/` route and stop the collector while retaining the SQLite volume for
the agreed retention window. Re-enabling requires both the pinned application
ref and the recorded collector digest.
