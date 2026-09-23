# Activity-fit prompt experiment — 2026-09-13

Issue: https://github.com/r4iju/music-gippity/issues/15

## Decision

Neither candidate was adopted. The final production prompt is byte-for-byte identical to baseline. Round 1 reduced combined activity mismatch/uncertainty from 38/270 to 26/270 (27 after the recording correction below), but worsened Gemini study fit, Spotify resolution and latency, and slightly worsened OpenAI workout. Round 2 increased activity flags from 29/270 to 46/270, with workout regressions in both generators. The activity limitation remains unresolved.

The next investigation should make the judge review the resolved recording identity, then validate it against a small set of source-supported vocal/version cases. This experiment does not establish that a stronger prompt, a second model pass, or an automated score would solve activity selection.

## Protocol

Compare baseline `9208d89` with candidate `e20fd93` (round 1) and `0620867` (round 2). Each round has three repetitions of three briefs through both generators for each variant: 36 playlists, 720 track judgments. Alternate batches baseline 1, candidate 1, candidate 2, baseline 2, baseline 3, candidate 3. All generation runs use clean committed trees. Candidate 2 was written after examining round 1; round 2 is a fresh comparison, not a pooled estimate.

Only the shared generation system prompt changes. Briefs, creativity, generator settings, Spotify resolution, and the fixed Gemini judge remain unchanged. OpenAI uses `gpt-5.6-terra` with reasoning off; Gemini uses `gemini-3.8-flash` with low thinking. The judge uses Gemini at temperature 0 and does not see generator identity. Each batch runs sequentially with 15 seconds between cases.

The adoption condition is improved activity fit without a material regression in either generator, the night-drive control, discovery, Spotify resolution, or latency. These small repeated samples are exploratory; they do not establish statistical significance. Judge verdicts are advisory, and uncertainty is reported separately from mismatch.

## Candidate instructions

These rules were inserted after the brief-interpretation rule and before artist uniqueness. Round 2 replaces the round 1 additions entirely.

### Round 1 additions

- Treat the brief's activity requirements and explicit exclusions as constraints on every track. Meet creativity, familiarity, scene/era variety and sequencing goals within those constraints.
- Choose for the whole recording, including its intro, breakdowns, climax and outro, rather than an artist's reputation or a genre/mood tag. Continuous vigorous exercise needs a sustained driving pulse; quiet concentration needs restrained dynamics. Follow the intensity and changes the brief actually requests, without adding an unsolicited warm-up, cooldown or dramatic peak. Slower cruising tracks can suit a driving brief. Study alone does not prohibit vocals; when the brief requests no voices, exclude sung/spoken passages and vocal samples in the exact version selected.
- If unsure a recording meets an explicit activity or vocal constraint, choose another recording you know fits. Find discoveries within the requested experience rather than relaxing its requirements for an obscure pick.

### Round 2 additions

- Use explicit activity requirements and exclusions as eligibility filters for every recording, including replacements. A track that breaks one is ineligible even if its genre, artist or mood fits. For a no-voices brief, that includes spoken and sampled voices; for continuous high energy or restrained concentration, consider the whole arrangement, including breakdowns and climaxes.
- Choose the mix of anchors and discoveries, era/scene variety and listening order from eligible recordings. Where steady intensity is requested, do not add an unsolicited warm-up, cooldown or dramatic peak. Apply only the restrictions actually requested; preserve the brief's genre and cultural direction.

## Exact briefs

### night-drive (15 tracks, balanced)

Nocturnal synthwave for a long drive

### continuous-workout (30 tracks, balanced)

30 tracks of hard-hitting pop and electronic music for continuous vigorous exercise. Every track should sustain a strong driving pulse and high energy. No warm-up or cooldown section, slow cruisers, ballads, ambient intros, or extended quiet breakdowns. Vocals are welcome; do not repeat artists.

### instrumental-study (15 tracks, balanced)

Instrumental electronic music for quiet reading and sustained concentration. Keep a steady, restrained energy: no sung or spoken vocals, vocal samples, sudden loud peaks, festival drops, or abrupt stylistic jumps. A gentle pulse is welcome; this is not a sleep playlist. No repeated artists.

## Round 1

Local raw artifacts: `evals/results/activity-comparison-2026-09-13T07-18-25Z/` (gitignored). Each JSON preserves exact rendered prompts, track order, Spotify candidates, per-track reasons, uncertainty and failures.

All cells show **baseline → candidate**, summed over three runs unless labelled median. M/U means mismatch/uncertain; denominators are 90 workout tracks or 45 study/control tracks per variant. Spotify counts mean candidates found, not verified recording identity. Artist counts are the union across runs, not a measure of musical novelty.

| Case | Engine | Track M/U | Spotify candidates | Artist union | Creativity fit / 3 | Median first track (s) | Median generation (s) |
|---|---|---|---|---|---|---|---|
| continuous-workout | chatgpt | 5/2 → 8/0 | 90 → 90 | 48 → 55 | 3 → 3 | 1.76 → 1.82 | 10.26 → 9.89 |
| continuous-workout | gemini | 16/1 → 5/2 | 89 → 90 | 48 → 53 | 3 → 3 | 1.46 → 1.68 | 10.00 → 9.58 |
| instrumental-study | chatgpt | 10/0 → 5/0 | 45 → 45 | 24 → 27 | 3 → 3 | 2.02 → 1.83 | 8.05 → 7.83 |
| instrumental-study | gemini | 2/2 → 6/0 | 44 → 41 | 26 → 25 | 3 → 3 | 1.35 → 1.28 | 7.48 → 9.66 |
| night-drive | chatgpt | 0/0 → 0/0 | 45 → 45 | 20 → 20 | 1 → 0 | 2.18 → 2.15 | 6.57 → 6.53 |
| night-drive | gemini | 1/0 → 0/0 | 45 → 45 | 26 → 23 | 3 → 3 | 1.45 → 1.51 | 7.50 → 7.50 |

All 36 samples completed with valid judge output and no structural failures.

## Round 2

Local raw artifacts: `evals/results/activity-comparison-2026-09-13T07-37-57Z/` (gitignored). Each JSON preserves exact rendered prompts, track order, Spotify candidates, per-track reasons, uncertainty and failures.

All cells show **baseline → candidate**, summed over three runs unless labelled median. M/U means mismatch/uncertain; denominators are 90 workout tracks or 45 study/control tracks per variant. Spotify counts mean candidates found, not verified recording identity. Artist counts are the union across runs, not a measure of musical novelty.

| Case | Engine | Track M/U | Spotify candidates | Artist union | Creativity fit / 3 | Median first track (s) | Median generation (s) |
|---|---|---|---|---|---|---|---|
| continuous-workout | chatgpt | 4/1 → 10/2 | 90 → 90 | 50 → 59 | 3 → 3 | 1.86 → 2.60 | 9.97 → 10.57 |
| continuous-workout | gemini | 8/0 → 16/0 | 90 → 90 | 50 → 47 | 3 → 3 | 3.52 → 1.66 | 12.96 → 11.09 |
| instrumental-study | chatgpt | 11/0 → 10/2 | 44 → 45 | 23 → 22 | 3 → 3 | 1.77 → 1.54 | 7.22 → 6.74 |
| instrumental-study | gemini | 5/0 → 5/1 | 44 → 43 | 31 → 25 | 3 → 3 | 1.69 → 1.88 | 7.99 → 8.13 |
| night-drive | chatgpt | 0/0 → 0/0 | 45 → 45 | 20 → 20 | 2 → 0 | 2.15 → 2.05 | 6.51 → 5.91 |
| night-drive | gemini | 1/0 → 0/0 | 45 → 42 | 24 → 23 | 3 → 3 | 1.67 → 1.40 | 5.88 → 7.88 |

All 36 samples completed with valid judge output and no structural failures.

## Recording audit and limits

Round 1 contains a verified false pass: candidate OpenAI study run 2 requested Rone’s “Bora”, while baseline OpenAI study run 2 requested “Bora Vocal”. Both resolved to Spotify ID `36OgYOMjRYkqtQDD8drsN7`. The judge marked the shortened title fit and the explicit vocal title mismatch. [Spotify names the recording Bora Vocal](https://open.spotify.com/track/36OgYOMjRYkqtQDD8drsN7), and [InFiné credits Alain Damasio’s voice](https://infine-music.com/presse/Rone/RWAV/Album/Bio/iF1057CP-Rone-RWAV-FR.pdf). Keeping raw output intact, a separate correction changes round 1 candidate OpenAI study mismatches from 5 to 6 and combined activity flags from 26 to 27.

The three source-audited recording IDs (Bora Vocal, Haul, An Intention) were checked across both variants. Round 2 occurrences were already labelled mismatch, so that audit adds no correction to round 2. This is a targeted audit, not exhaustive verification of all fit labels.

For example, round 2 candidate OpenAI study run 1 included Christian Löffler’s “Haul” and Kaitlyn Aurelia Smith’s “An Intention”; the judge flagged their voices against the exact no-voices brief. [The artist’s Mare credits name Mohna on Haul](https://christianloffler.bandcamp.com/album/mare), and [Pitchfork’s track review describes the vocals in An Intention](https://pitchfork.com/reviews/tracks/kaitlyn-aurelia-smith-an-intention/). By contrast, its flag for Max Cooper’s “Order from Chaos” concerns a distracting intensity build, which remains a subjective assessment.

This was a source audit, not a listening test. Energy and concentration judgments remain subjective. Artist-level familiarity does not establish a recording’s vocal content, and a found Spotify candidate does not prove the exact requested version was matched. The judge sees the emitted song title; the Bora discrepancy demonstrates why that distinction matters.

## Reproduction

Use the commits above in separate checkouts, install with `bun install --frozen-lockfile`, and provide the same development provider credentials. Run the following command in the specified six-batch order for each round, retaining every JSON/Markdown output and failed attempt:

```sh
EVAL_CASES=continuous-workout,instrumental-study,night-drive EVAL_ENGINES=chatgpt,gemini EVAL_JUDGE_ENGINE=gemini EVAL_PAUSE_MS=15000 bun run eval
```

Group by case, engine and variant; sum track verdicts and Spotify candidates, count unique normalized artist names across the three lists, and take medians of `firstSongMs` and `totalMs`. Preserve the per-run “same as last run” overlap field as a drift signal; history differs between checkout directories, so it is not a paired baseline/candidate similarity metric.
