# Music Gippity

A small app that turns a text prompt into a Spotify playlist, streaming song
suggestions from an LLM as they arrive. Bootstrapped with
[create-t3-app](https://create.t3.gg/).

## Stack

- Next.js (App Router, React Compiler, Turbopack) on Vercel
- tRPC for queries and mutations, TanStack Query on the client
- Drizzle ORM on Turso (libSQL)
- Auth.js with the Spotify provider
- Tailwind CSS v4 and Radix UI
- Two LLM engines, OpenAI and Gemini, called over plain `fetch` from edge
  routes that stream NDJSON back to the wizard. Engine ids, model ids, and
  labels live in one registry at `src/lib/engines.ts`.

## Live demo

<https://music-gippity.vercel.app>. The Spotify app is in Development Mode,
so signing in needs an allow-listed Spotify account (five per app, Premium
only); ask for access. Leaving Development Mode needs Spotify's extended
quota, which since May 2025 is granted only to registered organisations;
see [docs/spotify-extended-quota-application.md](docs/spotify-extended-quota-application.md).

## Spotify Developer Policy

Spotify's Developer Policy forbids feeding Spotify Content (catalogue
metadata, playlists, and user data) into a machine learning or AI model. The
app's invariant is therefore: **nothing read from Spotify ever enters an
engine request**. The engines propose artist and song names from the brief
alone; Spotify is used only afterwards, to resolve those names to recordings
and to create the playlist in the listener's account.

- The curator, planner, rerank and vocal-review prompts receive the brief,
  the settings, the engine's own picks and evidence from open databases
  (MusicBrainz, Last.fm, Deezer, lrclib, ListenBrainz). They never receive
  Spotify titles, ids, ISRCs, artwork or the listener's library.
- The listener's top, saved and recent tracks (the *known set*) are read to
  mark familiar songs in the interface and to enforce a discovery
  playlist's novelty budget mechanically. The set is compared in the app
  and discarded; it is never stored or shown to a model.
- OAuth scopes are the minimum for those features and are listed with
  their reasons in `src/lib/spotify-scopes.ts`.
- Track and playlist views carry the Spotify logo and a *Listen on Spotify*
  link (`src/components/spotify/`), and AI-written text is labelled as such.
- `/privacy` and `/terms` describe the data use; *Disconnect Spotify* on the
  account page deletes everything the app holds about the account at once
  (`src/server/account-deletion.ts`).

`tests/spotify-content-boundary.test.ts` runs a full generation against a fake
Spotify that answers with sentinel strings and fails if any engine request
body contains one.

## Local development

```sh
bun install
bun run dev        # starts a local Turso instance and next dev on :3025
```

Other scripts:

```sh
bun run check      # biome lint + format
bun run typecheck  # tsc --noEmit
bun run test       # bun test (edge routes with providers faked at fetch)
bun run build
bun run eval       # live curator eval: real engines + Spotify, reads .env.development
```

## Curation

Every engine call sends the same curator system prompt (persona, no repeated
artists, era/subgenre spread, exact Spotify spelling, NDJSON output) plus
a per-request brief. The **creativity** setting (safe / balanced / adventurous)
maps to both a temperature and an instruction clause. Reasoning is turned off
(OpenAI `reasoning_effort: none`, Gemini `thinkingLevel: low`) because it added
~15s before the first track without improving picks.

Tracks the engine names that Spotify cannot find are retried with a plain-text
search and, if still missing, swapped in place for a substitute the same engine
suggests.

For a *Discover* playlist the curator is offered candidates gathered from
MusicBrainz (artists by tag, area and label) and Last.fm charts; the listener's
known set then filters those candidates and caps how many known tracks and
artists the final playlist may contain. The known set and the listener's top
artists are never described to the engine.

### Quality evaluation

`bun run eval` runs eight cases through both engines: explicit industrial/EBM
at all three creativity settings, nocturnal synthwave, rainy-Sunday bossa nova,
90s UK garage, 30-track continuous vigorous exercise, and instrumental study.
Briefs and their criteria live in `evals/cases.ts`. The industrial brief is an
authored evaluation scenario, not a reconstruction of a user's historical prompt.

A fixed Gemini judge reviews the final tracks against the exact brief and
creativity instruction, without seeing the generating engine's identity.
Each track receives **fit / mismatch / uncertain** with a specific reason.
Scene coverage, discovery, sequencing, and description truthfulness are assessed
separately where applicable. Descriptions are checked against the final songs,
including any named artists lost during replacement.

These are **advisory, uncalibrated judgments**, based on model knowledge and
metadata, not listening or verified audio/release data. Unknown recordings must
remain uncertain; a resolver hit does not establish correct recording
identity or musical fit. Review the reasons and verify disputed facts before
using the results to change prompts. A fixed judge can still have style/provider
biases; changing the judge is useful for a second opinion, not a comparable score.

The console retains count, artist uniqueness, on Spotify rate,
replacement count, generation latency, and “same as last run.” Judge latency is
separate. Overlap searches history for the latest matching brief, count,
creativity, engine and model; legacy runs assume the old balanced setting and
are explicitly marked as having unverified model/configuration. Overlap is a
drift signal, not a reward for novelty or a measure of quality.

Each run writes JSON plus a readable Markdown report to `evals/results/`
(gitignored). JSON includes source revision/dirty state, system and rendered
user prompts, model/settings, rubrics, description, song emissions and final
tracks, and the judge's input and raw response. Generation results are saved
before judging, and reports are updated after every case. Structural failures
(wrong count, repeated artists, missing metadata, <80% on Spotify) and
failed/incomplete judge responses fail the command after saving results;
musical mismatches and uncertainties do not. A partial interrupted run is
marked `complete: false`.

The eval's Spotify token is a client-credentials one, which cannot read an
account, so the listener comes from `evals/listener.json`: a frozen snapshot
of a listener's saved tracks, top tracks and recent plays. The
route reads it in place of Spotify's `/me` reads, so the known and budget
columns compare between runs. The committed snapshot is a fictional
persona built from public catalogue tracks (late-night electronic and
jazz-adjacent), not anyone's account. To evaluate against a real account, take
a snapshot with `bun run eval:snapshot-listener`, which reads that account's
refresh token from the database (`EVAL_LISTENER=<Spotify account id>` chooses
between several), and keep it out of commits: it is listening history. Those
columns only compare between runs on the same snapshot.

For focused iteration (uses `.env.development`, real paid model calls and the
dev Spotify app; authentication and database writes are faked by the test preload):

```sh
EVAL_CASES=continuous-workout,instrumental-study EVAL_ENGINES=chatgpt bun run eval
EVAL_CASES=industrial-adventurous EVAL_JUDGE_ENGINE=chatgpt bun run eval
```

`EVAL_CASES` and `EVAL_ENGINES` accept comma-separated IDs; the judge accepts one
engine. Invalid/empty values fail before provider calls. Omit filters for the
full matrix. Cases pause for 15 seconds between runs to reduce shared-provider
rate-limit bursts (`EVAL_PAUSE_MS=0` disables pacing; maximum 60000). A 429 still
remains an explicit evaluation error; rerun the affected cases after the quota
recovers. To compare prompt variants, use the same cases, generation settings,
and judge; inspect multiple runs and per-track reasons rather than treating one
sample or a count of “fit” labels as proof of improvement.

## Environment

The env schema in `src/env.mjs` is the source of truth. You need:

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Auth.js |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify developer app |
| `OPENAI_KEY`, `OPENAI_ORGANIZATION_ID` | OpenAI engine |
| `GEMINI_API_KEY` | Gemini engine |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Database |

Database scripts (`db:generate`, `db:push`, `db:migrate`, `db:studio`) read
`.env.production`.

## Remaining ideas

The [activity-fit experiment](evals/activity-fit-2026-09-13.md) records two prompt
candidates rejected after repeated baseline comparisons, including a verified
judge false pass and the limits of automated fit judgments.

### No-voices repair

When a brief uses supported vocal/instrumental wording, creation checks the
resolved Spotify recordings after the playlist has streamed. Gemini identifies
confident vocal violations and proposes substitutes; OpenAI checks the resolved
substitutes for both vocal content and fit to the complete original brief. Only
substitutes passing both checks replace the original slot. Missing candidates,
duplicate artists/recordings, uncertainty, invalid output and provider failures
preserve the original. Each model check has a 15-second deadline; Spotify lookup
time is additional. Generation still uses the selected engine and creativity.

This is a model-knowledge check, not audio verification or a guarantee of no voices.
The cue filter recognizes English wording such as “no vocals”, “without voices”
and “instrumental”, Spanish “sin voces”/“sin voz”/“instrumentales”, and several
other vocal terms. Unsupported wording bypasses repair. The reviewer decides
whether the brief actually prohibits all voices; focus/study alone, mostly
instrumental and vocals-welcome briefs do not establish that prohibition.

Live eval JSON retains the original resolved snapshot, actual Spotify identity,
review prompts, per-track reasons, uncertainty and every proposed substitute's
outcome. Markdown reports show the review reasons and rejection outcomes.
To compare existing runs, pass their JSON paths:

```sh
EVAL_INPUTS=evals/results/run1.json,evals/results/run2.json bun run eval:compare-vocals
```

Both judges assess the union of before/after recordings once, using the exact
brief. An unchanged recording gets the same verdict on both sides. These judges
also participate in production review, so agreement is not independent factual
verification; source checks and disagreements remain part of the quality review.

See the [no-voices repair evidence](evals/no-vocals-2026-09-13.md) for paired results,
source checks, failures, control runs and remaining limitations.

### Recording evidence experiment

`bun run eval:recording-evidence` compares model-only vocal judgments with frozen,
source-backed evidence for the same recordings (two engines, three repetitions).
This is a research benchmark using manually selected evidence, not production search.
See [method, sources and decision](evals/retrieval-evidence-notes.md) and
[results with reasons and uncertainty](evals/recording-evidence-2026-09-13.md).
Render a saved run with `bun evals/summarize-recording-evidence.ts <result.json>`.

## License

MIT, see [LICENSE](LICENSE). The Spotify logo files under `public/assets/spotify`
are Spotify trademarks used under its design guidelines and are not covered by
the MIT licence.
