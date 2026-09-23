# Durable playlist generation

Approved direction: each generation creates a new UUID-addressed playlist. The database is authoritative; the viewer connection is disposable. This supersedes the request-bound design in playlist-stream-recovery.md.

- POST with a stable UUID request key creates one generation. Repeating the same request returns it; reusing the key with different settings fails.
- Vercel Workflow runs independently of HTTP. A database claim fences duplicate starts before paid work. Failed generation preserves progress; it is never silently rerun with different tracks.
- The worker commits visible updates and increasing revisions atomically. Completion requires the exact requested set of resolved tracks.
- Authenticated snapshots, streams and history enforce ownership. Native Workflow streams publish only committed playlist UUID/revision/phase hints. The observer reloads snapshots on notifications, reconnect, online/focus/visibility restoration and every ten seconds while connected. Stream chunk cursors are not database revisions.
- Navigation and disconnect do not cancel work. Explicit cancellation is persisted and fences late writes. Already-performed provider work cannot be undone.
- Trying again creates a new UUID; previous partial/completed generations remain accessible. Browser storage is only a cache, not the source of truth.
- The generation row doubles as a transactional outbox: an authenticated server-side cron sweeps queued runs every minute after 20-second dispatch leases expire, even with no connected viewer. Only one worker acquires the database claim. Each phase sets its own deadline and the recovery sweep allows a further 60-second grace period. Expired paid attempts become ambiguous; they are never automatically regenerated.
- Existing saved-playlist data and legacy workflow step identities remain intact. New work uses separate playlist, run and checkpoint tables. Saving/exporting remains explicit.

Verification: local SQLite integration tests, mocked providers, controlled browser reconnection checks, Workflow compilation and deployment health. No live music evals or paid model calls. Apply additive migration before production deploy, review, merge and verify production.

Operations: configure a secret `CRON_SECRET` in production; Vercel sends it as the cron Authorization bearer token. `vercel.json` registers the per-minute sweep (Pro plan). Failed dispatches remain durable and retry on later sweeps; a 503 sweep response exposes partial failures in logs. The cron does not initiate new generations or replay paid generation work.

## Checkpoints and liveness

The deterministic Workflow orchestrates intent → retrieval → curation → resolution → checking → repair → rerank → finalization. Version-1 checkpoints validate their stage output before commit. Confirmed outputs are reused before acquiring credentials. Paid reservations are marked immediately before paid work; unknown outcomes fail visibly instead of repeating charges. Safe incomplete attempts can be retried, with attempt-token fencing for late progress.

Stage bounds: intent 30s, retrieval 120s, curation 420s, resolution 180s, checking 180s, repair 420s, rerank 60s, finalization 30s. These include persistence overhead; external calls have their own tighter bounds. SDK retries cannot bypass paid reservations. Cancellation retains recordings and fences further commits. Finalization atomically requires every validation checkpoint and the exact requested resolved recording set.

Publication runs after commit and is coalesced, failure-isolated and bounded to a 250ms final drain. Successful terminal steps explicitly close their native stream. The authenticated transport cancels its reader on disconnect or after 50s; Vercel request cancellation is enabled for that route. Missing/failed publication is repaired by authoritative reconciliation, including a missing terminal event on an otherwise healthy stream.

## Deployment and rollback

1. Verify tests, typecheck, lint, Workflow build, isolated SQLite failure cases and controlled browser/runtime smoke. Do not run live evals or paid generation as a release check.
2. Inspect the production schema and ensure neither new migration is partially applied. Apply only `0004_checkpointed_playlists.sql` and `0005_generation_checkpoints.sql` in one explicit transaction. Production historically has no Drizzle migration ledger: do not replay migrations 0000–0003 or run an unsupervised schema push.
3. Verify all three new tables, unique owner/request and playlist/run indexes, foreign keys and unchanged legacy row counts before deploying. The old build ignores these additive tables.
4. Merge and verify the Vercel production deployment's Git SHA and Ready state. Check authenticated ownership boundaries, unauthenticated 401s, cron 200 and structured logs. Keep existing `CRON_SECRET`, Turso, Spotify and model credentials; no new paid provider is introduced.
5. Roll back code only if needed; never drop the new tables/checkpoints. A previous build cannot read new playlist URLs, so rollback is temporary service degradation for those links, not a data rollback. Preserve the deployment that owns in-flight Workflow runs and its unchanged step identities; never redirect ambiguous paid attempts into a fresh run. Prefer a forward fix that retains the new read/cancel/recovery interface.

Diagnostics use `component: playlist-generation` with create-acknowledged, dispatch/deferred, stage-reservation, checkpoint-reused-after-ack-loss, paid-outcome-ambiguous, committed and cancel-requested events. Creation joins playlist/generation identifiers; stage events include the Workflow owner and attempt. Browser reconnect diagnostics contain only playlist ID, revision and cursor. Provider request logging omits full prompts and error response bodies. Checkpoint/product contents remain private application data, not diagnostic payloads.
