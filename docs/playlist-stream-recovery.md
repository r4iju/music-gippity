# Recoverable playlist generation

Request: make stream hiccups safe and improve the surrounding playlist state.

- Received tracks survive transport failure, cancellation and reload. A restored active run becomes interrupted, never an endless spinner.
- Only a validated server completion manifest can finish a run successfully. EOF, malformed data, missing tracks and unresolved slots require attention.
- The current request owns its updates. Replaced, reset and unmounted requests cannot write late results.
- Generation has bounded idle and total waits and can be stopped by the listener.
- Cancellation reaches server generation and model requests; it prevents later phases from starting. Already-submitted Spotify/evidence lookups can still finish, and provider work already performed cannot be undone.
- Interrupted runs offer explicit keep-resolved-tracks or generate-again actions. Retry preserves the complete original request, including purpose and taste anchors; it starts new work, not a resume.
- Storage is validated and failures are visible. Old stored playlists migrate without trusting their loading flag.
- Save/export waits for completion or explicit acceptance of partial tracks. Failed or stale save/export responses cannot mark a newer draft successful.

The server does not persist a replayable generation log. No automatic retry or reconnect is offered: that would create another billable, potentially different playlist. Durable background generation and resumable event replay remain a separate architectural capability, not a property claimed by this change.

## Verification

Test-first stream/state checks cover interrupted restoration, stale run events, byte-fragmented Unicode, missing acknowledgement, malformed tails and blocked-reader cancellation. UI checks cover recovery actions and empty partial runs. Existing route assertions require the completion event. Browser QA exercises the actual provider with controlled transport failures.
