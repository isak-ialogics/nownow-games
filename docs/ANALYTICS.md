# Privacy-safe analytics

NowNow Games emits same-origin, cookieless aggregate counts to
`/analytics/count`. The collector contract is compatible with self-hosted
GoatCounter's stable tracking-pixel endpoint; the browser does not load code or
assets from a third party.

## Recorded measurements

Page visits use only the canonical pathname and static document title. Game
events use this fixed taxonomy:

`/event/{game-id}/{play-started|play-completed|share-triggered}/{new|returning}`

The six game IDs are `before-midnight`, `latch`, `safe-passage`, `same-flame`,
`surface-signal`, and `one-lucky-bloom`. Before Midnight's historical `/event/before-midnight/...` counter
keys are unchanged.

- `play-started` fires after the game modules have initialized a playable game,
  and again when Retry starts another run. An expired Same Flame page does not
  count as a start.
- `play-completed` fires when the game's real result surface appears. The shared
  tracker accepts it only for an active run and suppresses repeated result
  mutations.
- `share-triggered` fires once per Share/copy-link button activation, before Web
  Share or the clipboard fallback. A single activation cannot double-count its
  two fallback paths. Latch and Safe Passage expose a result-page share action;
  Before Midnight and Same Flame retain their existing result sharing.
- `new` or `returning` is fixed when the page loads. `returning` means the
  browser already has a positive gameplay best for Before Midnight, Same
  Flame, Surface Signal, or a completed One Lucky Bloom record; otherwise it is `new`. This deliberately privacy-limited signal is a
  returning-player proxy, not a unique-person count. Analytics reads existing
  gameplay progress but creates no identifier and writes no browser storage.

Every event is a counter path, not an individual event record. A random
five-character cache buster is generated per request and discarded.

## Synthetic QA audience

Open a game with the exact query token `?nng_audience=synthetic-qa` during a
recorded QA window. The client maps that token to the fixed prefix
`/synthetic-qa`, for example:

`/synthetic-qa/event/latch/play-completed/new`

This keeps synthetic pageviews and events separate from organic aggregates.
Other query parameters and their values are ignored and are never copied into
analytics requests. The report owner should compare pre/post aggregate counts
for the labelled window and retain only aggregate evidence: no raw visitor, IP,
User-Agent, or referrer rows.

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

The analytics collector and route remain separate from the NowNow application
container; this application change does not provision, move, or replace them.

1. Keep the pinned GoatCounter release and immutable image digest already owned
   by IAL.
2. Keep SQLite on its named persistent volume and individual pageviews disabled.
3. Keep public `https://nownowgames.co.za/analytics/count` routed to the
   collector's `/count` endpoint. Do not expose analytics under a third-party
   browser origin.
4. Keep edge access logs disabled or redacted for `/analytics/`, retain the
   privacy settings above, and keep the dashboard authenticated.
5. Reuse the existing Studio Lead dashboard/export and schema-aware aggregate
   report SQL. Do not expose or request raw-event access for QA proof.
6. The deployment stays on existing IAL capacity at zero recurring cost. Stop
   for Studio Lead approval before any cost is introduced.
7. Delivery follows the governed sequence: green CI, automatic DEV, independent
   labelled Hermes QA with pre/post persisted aggregates, explicit promotion of
   the verified SHA/digest, automatic PROD, then production route and aggregate
   verification.

## Rollback

Revert the application commit to stop browser emission and remove the two new
result-share controls. The collector, its persistent volume, dashboard, and
reporting ownership remain unchanged. If the collector itself must be stopped,
IAL removes the `/analytics/` route and stops the pinned service while retaining
the SQLite volume for the agreed retention window.
