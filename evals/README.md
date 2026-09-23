# Evals

Live evaluations call the real engines and the dev Spotify app, so they cost
money and read `.env.development`. Authentication and database writes are
faked by the test preload.

## Curator eval

`bun run eval` runs eight cases through both engines: industrial/EBM at all
three creativity settings, nocturnal synthwave, rainy-Sunday bossa nova, 90s
UK garage, a 30-track continuous workout, and instrumental study. Briefs and
criteria live in `cases.ts`.

```sh
EVAL_CASES=continuous-workout,instrumental-study EVAL_ENGINES=chatgpt bun run eval
EVAL_CASES=industrial-adventurous EVAL_JUDGE_ENGINE=chatgpt bun run eval
```

`EVAL_CASES` and `EVAL_ENGINES` take comma-separated ids; the judge takes one
engine. Invalid or empty values fail before any provider call. Omit both for
the full matrix. Cases pause 15 s between runs (`EVAL_PAUSE_MS`, max 60000,
`0` disables); a 429 is still an error, rerun those cases after the quota
recovers.

### Judge

A fixed Gemini judge reviews the final tracks against the exact brief and
creativity instruction without seeing which engine generated them. Each track
gets **fit / mismatch / uncertain** with a reason. Scene coverage, discovery,
sequencing and description truthfulness are assessed separately where
applicable; descriptions are checked against the final songs, including any
named artist lost during replacement.

These are advisory, uncalibrated judgments from model knowledge and metadata,
not from listening. Unknown recordings stay uncertain; a resolver hit does not
establish recording identity or musical fit. Read the reasons and verify
disputed facts before changing prompts on the strength of a run. A fixed judge
has style and provider biases; switching judges gives a second opinion, not a
comparable score. Compare prompt variants on the same cases, settings and
judge, across several runs, rather than on one sample or a count of "fit"
labels.

### Output

Each run writes JSON and a Markdown report to `results/` (gitignored). JSON
holds the source revision and dirty state, system and rendered prompts, model
and settings, rubrics, description, song emissions, final tracks, and the
judge's input and raw response. Generation results are saved before judging
and reports update after every case. Structural failures (wrong count,
repeated artists, missing metadata, under 80% resolved on Spotify) and failed
or incomplete judge responses fail the command after saving; musical
mismatches do not. An interrupted run is marked `complete: false`.

The console reports count, artist uniqueness, on-Spotify rate, replacement
count, generation latency, judge latency and "same as last run". Overlap is
computed against the latest earlier run with the same brief, count,
creativity, engine and model, and is a drift signal, not a quality score.

### Listener snapshot

The eval's Spotify token is client-credentials, which cannot read an account,
so the listener comes from `listener.json`: saved tracks, top tracks and
recent plays that the route reads in place of Spotify's `/me` endpoints. The
committed snapshot is a fictional persona built from public catalogue tracks,
not anyone's account. To evaluate against a real account run
`bun run eval:snapshot-listener` (`EVAL_LISTENER=<Spotify account id>` picks
one when several are stored) and keep the result out of commits: it is
listening history. Known and budget columns only compare between runs on the
same snapshot.

## No-vocals repair

When a brief uses supported vocal or instrumental wording, generation reviews
the resolved recordings afterwards. Gemini flags confident vocal violations
and proposes substitutes; OpenAI checks each substitute for vocals and for fit
to the full brief; only substitutes passing both replace the original slot.
Missing candidates, duplicate artists or recordings, uncertainty, invalid
output and provider failures keep the original. Each model check has a 15 s
deadline plus Spotify lookup time.

The cue filter recognises English wording such as "no vocals", "without
voices" and "instrumental", Spanish "sin voces", "sin voz" and
"instrumentales", and several other vocal terms; unsupported wording skips
repair. The reviewer decides whether the brief prohibits all voices; focus or
study alone, mostly instrumental, and vocals-welcome briefs do not.

Live eval JSON keeps the original resolved snapshot, the actual Spotify
identity, review prompts, per-track reasons, uncertainty and every proposed
substitute's outcome. To compare saved runs:

```sh
EVAL_INPUTS=evals/results/run1.json,evals/results/run2.json bun run eval:compare-vocals
```

Both judges assess the union of before and after recordings once against the
exact brief, so an unchanged recording gets the same verdict on both sides.
The same judges run in production review, so their agreement is not
independent verification. Paired results, source checks, failures and control
runs are in [no-vocals-2026-09-13.md](no-vocals-2026-09-13.md).

## Experiments

- [activity-fit-2026-09-13.md](activity-fit-2026-09-13.md): two prompt
  candidates rejected after repeated baseline comparisons, including a
  verified judge false pass and the limits of automated fit judgments.
- `bun run eval:recording-evidence` compares model-only vocal judgments with
  frozen, source-backed evidence for the same recordings (two engines, three
  repetitions). It is a research benchmark on hand-picked evidence, not
  production search. Method and decision:
  [retrieval-evidence-notes.md](retrieval-evidence-notes.md); results:
  [recording-evidence-2026-09-13.md](recording-evidence-2026-09-13.md).
  Render a saved run with `bun evals/summarize-recording-evidence.ts <result.json>`.
