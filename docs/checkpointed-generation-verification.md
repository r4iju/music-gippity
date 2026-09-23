# Checkpointed generation delivery evidence

Environment: isolated SQLite and Next local server on port 3037; fake upstream services or confirmed intent checkpoint plus intentionally absent local Spotify credentials. No live music evals or paid engine calls.

## Automated checks

The create/observe/cancel seam uses real SQLite and controlled dispatch/provider failures. Coverage includes owner-scoped idempotency and separate identities, confirmed paid checkpoint reuse, uncertain paid outcomes, watchdog expiry, commit-success/acknowledgement-loss, credential preparation, stale-attempt fencing, cancellation, validated idempotent finalization, truncated provider output and lost paid reranking. Observer tests cover canonical identity, stream loss, apparently healthy streams missing completion, offline presentation and immediate online reconciliation. New tests were observed red before implementation.

## Controlled manual interface traces

- All seven actual pipeline stages with fake provider wire responses completed through finalization (two resolved/evidenced recordings, revision 26) while the repository publication callback threw on every notification. No successful checkpoint or finalization was rolled back.
- Observer snapshots arrived at revisions 10, 9, 12, 11, 12, 13. Rendered revisions were exactly 10, 12, 13. Stream requests used cursors 0, 3, 0: resume after EOF, reset after unavailable cursor. Duplicate hints were ignored and wrong-playlist hints rejected; terminal convergence issued no create.
- The real local Workflow reused a confirmed intent checkpoint, retried credential preparation without issuing a paid call, and saved a retrieval failure. The native stream returned committed hints at cursors 1–5/revisions 5–9; unauthenticated stream access returned 401. Terminal stream closure is explicit, with a bounded failure-isolated drain.

## Browser checks

An isolated headless Chromium session exercised the actual Next UI and authenticated routes, with native stream requests deliberately aborted:

| Case | Result |
| --- | --- |
| Clear all browser storage, reload canonical playlist URL | Saved recording restored from DB |
| Add another recording and cancel while stream is broken | Both recordings and cancelled status converge without another create |
| Navigate away and reopen | Same saved partial playlist |
| Replace cache with stale content and reload | Canonical DB snapshot wins |
| Switch authenticated owner | Access error; previous owner's recordings absent |
| Open completed mocked pipeline | Completed two-recording result restored |

The browser issued zero generation POSTs. Confirmed remote content persisted to browser storage as zero songs; only settings remained. Screenshots are attached to the delivery PR. These are manual acceptance checks, not green regression tests backfilled after implementation.

Fresh review found two URL-handoff bugs. A browser reproduction with both storage reads and writes throwing failed to create (zero POSTs), and a delayed replacement disappeared during navigation. After retaining an owner-scoped ephemeral local-draft cache and delaying edit navigation until the result is stored, both checks pass. Development Strict Mode retries used one identical request key and one durable playlist. URL-session cleanup fences late replacement results. This in-memory cache, like browser storage, excludes acknowledged server-generated contents.

## Compatibility and rollout

Legacy saved playlists and generation readers remain; the existing `playlist-generation` Workflow and step names are unchanged. Additive migration, deployed SHA, cron and production auth checks are recorded on the delivery PR after deployment. Parent spec #78 remains unchanged.
