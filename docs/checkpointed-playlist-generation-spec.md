# Checkpointed playlist generation with durable observation

## Problem Statement

A listener should be able to start a playlist, leave the app, lose their connection, and return to the same saved result without restarting work or unexpectedly paying for another generation. They should understand what is happening and retain useful recordings if generation fails.

The shipped design preserves progress independently of the browser, but most curation runs inside one long Workflow step. A worker failure cannot recover at meaningful internal checkpoints. Browser streaming repeatedly reads the database, and generation state, playlist contents and browser cache still overlap in responsibility. These limitations make recovery, cost control and future changes harder to reason about.

## Solution

Keep playlists authoritative in the database, use Vercel Workflow to execute checkpointed generation stages, and use native Workflow streaming only to notify viewers that saved state changed. Present every playlist at a stable UUID-addressed page with real phase/count progress and separate connection status.

The generation module exposes a small create/observe/cancel interface and owns idempotency, durable dispatch, checkpoint recovery, cancellation, ordering and reconnection. The browser observes saved state; it does not keep generation alive. Stream delivery is never a prerequisite for saving or completing a playlist.

## User Stories

1. As a listener, I want starting generation to create a durable playlist immediately, so that I have a stable destination before curation finishes.
2. As a listener, I want the playlist URL to identify the saved playlist, so that refreshing or reopening it returns to the same work.
3. As a listener, I want double-clicking Generate to create only one generation, so that I do not accidentally incur duplicate work.
4. As a listener, I want a retried creation request to return the original playlist, so that an uncertain network response does not create another one.
5. As a listener, I want generation to continue when I navigate away or close the tab, so that my connection is not responsible for execution.
6. As a listener, I want to reopen a playlist from another signed-in browser, so that browser storage is not required to recover it.
7. As a listener, I want saved recordings to appear incrementally, so that I can see useful progress before completion.
8. As a listener, I want displayed saved progress to already exist in the database, so that a refresh does not make it disappear.
9. As a listener, I want truthful generation phases and recording counts, so that I understand progress without invented percentages.
10. As a listener, I want connection loss shown separately from generation failure, so that I know whether work is still happening.
11. As a listener, I want reconnection to restore the latest saved snapshot, so that missing stream messages cannot lose my playlist.
12. As a listener, I want the app to recover through snapshot reads when streaming is unavailable, so that the transport is optional.
13. As a listener, I want old or duplicated notifications ignored, so that my playlist never moves backward in revision.
14. As a listener, I want safe recovery to reuse completed stages, so that a later failure does not repeat successful research or curation.
15. As a listener, I want uncertain paid requests to stop rather than silently replay, so that recovery does not hide additional charges.
16. As a listener, I want a failed generation to retain its resolved recordings, so that useful partial work remains available.
17. As a listener, I want failure information to identify the affected phase and available next action, so that I can decide what to do.
18. As a listener, I want explicit cancellation to stop further committed progress, so that late worker results cannot override my choice.
19. As a listener, I want cancellation to retain progress already saved, so that stopping does not discard my playlist.
20. As a listener, I want Generate another to create a new playlist and generation, so that previous partial or completed results remain accessible.
21. As a listener, I want to keep and explicitly save or export usable partial results, so that a failed process does not make a playlist worthless.
22. As a listener, I want my unsent brief recoverable locally, so that I can return to composing it without making local storage authoritative for generated results.
23. As a listener, I want my existing saved playlists and generation links preserved during rollout, so that the architecture change does not erase or strand earlier work.
24. As a listener, I want my playlists, progress and failure details visible only to me, so that knowing a playlist or workflow identifier does not expose them.
25. As a listener, I want the curator to preserve my intent, hard rules, creativity and taste anchors, so that infrastructure changes do not change the product's curation contract.
26. As a maintainer, I want committed generations dispatched without an open viewer, so that a failure between database creation and Workflow start is recoverable.
27. As a maintainer, I want duplicate dispatches and worker redeliveries fenced, so that recovery cannot start competing paid work.
28. As a maintainer, I want phase, checkpoint and failure information correlated with playlist, generation and Workflow identities, so that production failures are diagnosable.
29. As a maintainer, I want a single generation interface for screens and behavior tests, so that reliability logic is not repeated across callers.
30. As a maintainer, I want failure-injection verification without paid engine calls, so that resilience can be tested economically and repeatably.

## Implementation Decisions

### Ownership and identities

- The database owns product state. Workflow owns execution and durable stage scheduling. Native Workflow streams carry notifications, not authoritative playlist contents.
- Separate the playlist record from its generation record. A playlist contains owner, immutable generation settings, name/description, slots and recordings, retained evidence/reasons, revision and existing save/export semantics. A generation contains its own identity, playlist relationship, execution ownership, Workflow run identity, lifecycle status, current phase, checkpoints and structured failure information.
- Preserve the domain meaning of Generation: one attempt to build a playlist from a brief, with its own identity and retained progress. Safe stage retries are part of that attempt. Explicitly generating again creates a new generation and a new playlist; it never overwrites an earlier result.
- A Workflow execution identifier is not a playlist identity. Duplicate dispatch attempts must not replace the owning run or its notification stream after another run has acquired execution ownership.
- Use a stable UUID-addressed playlist page. Existing generation/history links must continue to resolve, directly or through compatibility routing. Browser navigation and refresh do not create or cancel generation.
- Scope the creation idempotency key to the authenticated owner. Repeating the same normalized settings and key returns the same resource; changing settings under that key yields a conflict. Transient infrastructure errors remain retryable and are not mislabeled as conflicts. Prevent duplicate user submission synchronously.

### Generation module and durable dispatch

- Establish one deep generation module with create, observe and cancel as its primary interface. Observation includes the authoritative snapshot and connection status. Implementation details such as Workflow identifiers, stream cursors, dispatch leases and retry bookkeeping are hidden from screens.
- Prefer the existing persistence, generation-state and observation behavior when consolidating this module; do not add a second competing reliability layer.
- Create playlist, generation and durable dispatch intent atomically before acknowledging creation. The current generation-row outbox pattern may be retained if it satisfies the separated-record contract.
- Keep server-side recovery of undispatched work, independent of viewers. Dispatch retries and duplicate Workflow starts must be safe through execution ownership and idempotent persistence. An expired dispatch lease must not replay a paid stage that already started.
- Reconciliation distinguishes an undispatched generation, a safely retrying stage, a live worker and a lost worker. Do not apply the current whole-run timeout blindly to a multi-stage workflow; enforce documented per-stage bounds and liveness/retry policy.

### Checkpointed Workflow execution

- Replace the single long generation step with meaningful durable stages: interpret the brief into intent; retrieve candidates and relevant listener context; curate picks; perform resolution; check evidence and repair; rerank and finalize. The exact internal scheduling may overlap safe independent work while preserving these checkpoint semantics.
- Preserve existing curation behavior, including hard rules, caps, version handling, origin, evidence, repair, purpose/budgets, rerank and reasons. This is an execution redesign, not a curation-quality redesign.
- Persist validated, versioned stage outputs and the corresponding product progress. Completed checkpoints must survive worker loss and be reusable without repeating their successful external work. Checkpoint records must distinguish unfinished partial output from completed stage results.
- Fence stage completion and playlist updates by generation ownership and expected state/revision. A duplicate step execution must reuse a completed checkpoint rather than append duplicate slots or overwrite newer progress.
- Keep orchestration deterministic and external effects inside Workflow steps. Use bounded concurrency for independent resolution/evidence work. Never checkpoint credentials or expose them through snapshots or notifications; acquire server-side credentials with validity appropriate to the stage.
- Define retries by operation, not one global setting. Safe reads and idempotent writes may retry with bounds/backoff. Paid requests need provider-supported idempotency or durable confirmation that a completed result can be reused. Do not assume all engines support idempotency or that Workflow implies exactly-once external execution.
- If a paid request may have completed but its result cannot be recovered safely, persist a failed generation with an explicit ambiguous-outcome reason and retained progress. Do not silently repeat it. A listener-authorized new generation is a new resource, not a disguised reconnect.
- Finalization is an idempotent committed transition. Mark completion only when the requested set of resolved recordings and existing final validation requirements are satisfied. A stream closing is not completion.

### Native notification streaming and observation

- Use native Workflow writable/readable streams for small committed-state notifications containing playlist identity, database revision and phase. Do not poll the database every second inside a streaming HTTP handler, and do not persist raw token streams as the product model.
- Commit a meaningful playlist/checkpoint update and its monotonic revision before publishing its notification. Notification failure must not roll back saved progress, fail an otherwise successful generation, or cause paid curation to rerun.
- Treat database revision and Workflow stream chunk index as distinct coordinates. The former orders product snapshots; the latter resumes stream delivery. Neither is inferred from the other.
- On initial observation or reconnect, load an authenticated database snapshot, then resume notifications from a safe cursor. If the cursor is absent or unusable, replay safely or reconcile from a fresh snapshot. Ignore stale/duplicate notifications and reject snapshots belonging to another playlist.
- Handle the snapshot/subscription race and commit/publish gap explicitly. A missed notification must eventually be repaired by snapshot reconciliation even while the stream appears connected. Coalesce notification-triggered refreshes so a burst does not create one read per token or regress state through out-of-order responses.
- Retain bounded, backoff-based snapshot fallback when streaming fails. Reconcile on return to the page or restored connectivity. Once the generation is terminal, stop its live observation work after loading authoritative terminal state.
- Authorize snapshot, history, cancellation and stream access by playlist owner before exposing execution details. Knowing a Workflow run ID is not authorization.

### Browser behavior, lifecycle and cancellation

- The URL selects the playlist; server snapshots own generated contents. Browser storage may retain an unsent brief or disposable cache, but clearing it cannot lose or control server-side generation state. An empty local default must never overwrite a saved playlist.
- Model generation status separately from connection status. Generation lifecycle is queued, running, completed, failed or cancelled; phase is a separate field. Connection lifecycle is connected, reconnecting or offline, with an appropriate initial connecting presentation.
- Represent playlist usability and explicit acceptance of partial recordings separately from generation success. Keeping a partial playlist does not rewrite a failed or cancelled generation as completed.
- Display truthful phases such as finding candidates or matching recordings and counts with a defined meaning. Do not fabricate a percentage or imply that an unresolved pick is a ready recording.
- Persist cancellation before best-effort cancellation of execution. Check cancellation at stage transitions and within long-running work. Fence all late progress/finalization writes, retain committed recordings and never imply that already-incurred external cost can be undone.
- Surface actionable, sanitized failure information without leaking credentials or sensitive engine payloads. Preserve ownership isolation for local caches as well as server reads.

### Rollout and operability

- Evolve the production schema additively and preserve existing saved playlists, historical partial generations and their identities. Introduce compatibility mapping where the current combined generation snapshot must be represented as separate playlist and generation records.
- Deliver checkpointed execution first, then native streaming and browser consolidation through the same stable generation interface. This is sequencing of the full agreed scope, not a deferral of streaming or state cleanup.
- Allow already-running workflows to finish under their existing execution contract, or provide an explicit safe version transition. Do not rename/remove live step contracts or replay ambiguous paid work during migration.
- Record enough structured information to diagnose dispatch, phase attempts, checkpoint reuse, cancellation, reconnects and ambiguous outcomes using playlist/generation/run identifiers. Do not log credentials or full private briefs by default.

## Testing Decisions

- Primary seam: the generation module's create/observe/cancel interface. Exercise caller-visible behavior against real isolated SQLite persistence and controlled engine/transport failures. Use internal adapters only where an actual external dependency varies; do not build a second public testing interface around repository internals.
- A good test demonstrates a product invariant under failure, not a private function call sequence, exact number of SQL statements, or Workflow implementation detail. Assert identities, saved snapshots, phase outcomes, notification ordering, cancellation and counts of external paid attempts where those counts express the cost contract.
- Prior art exists in the project's real-SQLite idempotency/ownership/cancellation/outbox tests, injected-transport observation tests, credential-rotation tests, stream cancellation tests and mocked curation suites. Consolidate or adapt these at the higher interface rather than retaining redundant copies at every layer.
- Creation cases: repeated key with same settings, conflicting settings, duplicate submission, uncertain HTTP response and transient persistence failure. Assert exactly one durable playlist/generation and no extra paid work for transport retries.
- Execution cases: fail after each completed checkpoint and before the next stage; recover without repeating completed external work; inject duplicate dispatch and step redelivery; verify bounded retry behavior and preservation of existing curation outputs.
- Cost cases: simulate paid completion followed by loss before durable confirmation, and simulate recoverable completed results. Assert no silent ambiguous replay, and exercise provider idempotency only through a controlled adapter that actually supports the contract.
- Observation cases: drop notifications after DB commit, disconnect before/after subscription, use invalid/old cursors, deliver duplicate/out-of-order notifications and snapshot responses, and keep a stream apparently healthy while omitting a terminal notification. Assert eventual authoritative state without another create request.
- Cancellation cases: cancel queued and running generations, race cancellation with checkpoint/finalization writes, and redeliver late results. Assert cancellation retains saved recordings and rejects subsequent ownership-invalid writes.
- Isolation/migration cases: unauthorized reads/streams/cancel, absent local cache, existing saved playlists and old generation links, and in-flight legacy execution compatibility.
- Run a small browser check of navigating away, completion while absent, cache-cleared reopen and forced stream failure. Verify honest phase/connection presentation and terminal snapshot recovery. Use a real local Workflow smoke check with controlled credentials/dependencies to validate runtime integration without a paid engine call.
- When adding tests, write them before the corresponding implementation and confirm failure first. Do not backfill low-value green tests. Inspect/install the repository's package-manager dependencies before running them.
- Do not run live music evals, judge calls or paid engine generations for this work. Use deterministic fixtures, mocked external dependencies, normal static/build checks and targeted runtime smoke checks. Skipping evals does not disable the product's existing runtime checking and repair stages.

## Out of Scope

- Changing curator quality, retrieval strategy, engine selection, intent semantics, hard rules, caps, novelty/popularity policy, repair criteria or rerank behavior.
- Full event sourcing, a general-purpose messaging platform, or a second authoritative playlist store in Workflow history.
- Exactly-once billing guarantees unsupported by external engines, automatic replay of ambiguous paid calls, or automatic replacement of earlier playlists when retrying.
- Raw token replay as the durable playlist contract, invented progress percentages, or dependence on browser storage for generated results.
- New collaborative editing, sharing permissions, automatic Spotify export, or changes to the explicit save/export product behavior.
- Live evals and paid generation benchmarks.
- Implementation or deployment as part of publishing this spec; delivery will be a separate execution task.

## Further Notes

- This spec synthesizes the listener-approved redesign following [PR #77](https://github.com/r4iju/music-gippity/pull/77). It supersedes that design's single long generation step and per-viewer DB-polled stream while preserving its ownership, persistence, revision, outbox and cancellation safeguards.
- The user explicitly approved the primary testing seam: create/observe/cancel with real local persistence, controlled engine/stream failures and a small browser reconnect check, without live evals.
- Existing generation documentation remains historical context rather than being silently rewritten as if the new architecture had already shipped. Implementation should update the domain glossary to distinguish playlist, generation, phase and checkpoint consistently.
- Native streaming reference: [Workflow streaming](https://workflow-sdk.dev/docs/foundations/streaming). Provider idempotency support and Workflow runtime/version behavior must be verified during implementation rather than assumed from generic durability claims.
