# Recording evidence pilot, 2026-09-13

The proposed fixture is [retrieval-cases.json](./retrieval-cases.json): ten exact-version cases, five source-supported voice positives, three source-supported instrumental negatives, and two unscorable cases. Labels were established from sources before model runs; they were not calibrated against model verdicts. No audio was listened to for this research.

This is an **oracle evidence pilot**. Its manually selected, paraphrased evidence estimates the benefit of having useful evidence available. It does not measure a deployed search tool's ability to find those sources, identify versions, reject irrelevant pages, or do so cheaply. It is not an independent listening benchmark or an estimate of production accuracy.

## Fixture provenance

| Case | Proposed label | Source authority and boundary |
| --- | --- | --- |
| Koreless — Joy Squad | vocals | Artist's own track-by-track explanation, hosted by [Apple Music](https://music.apple.com/us/album/agor/1565923183). The relevant discussion appears under Frozen and explicitly includes Joy Squad. A search restricted to the Joy Squad paragraph would miss it. |
| Koreless — Primes | instrumental | Same artist interview supplies an explicit complete sound-material description. It is a stronger negative than missing credits, but still source-based. |
| Christian Löffler — Haul (feat. Mohna) | vocals | [Artist album page](https://christianloffler.bandcamp.com/album/mare) maps the contribution to this named track. Album version, not radio edit. |
| Christian Löffler — Lid | vocals | Same artist page gives a track-specific performer statement without a featured singer in the title. |
| Rosehip — Found | vocals | [Artist track page](https://rosehipmusicuk.bandcamp.com/track/found) identifies a spoken-source sample. |
| Blackdown — Slow It Down | vocals | [Artist track page](https://blackdown.bandcamp.com/track/slow-it-down) gives sample credits. The artist profile here must not be conflated with a same-name artist elsewhere. |
| The Blake Robinson Synthetic Orchestra — Mania (Instrumental Version) | instrumental | [Artist track page](https://syntheticorchestra.bandcamp.com/track/mania-instrumental-version) explicitly describes removal of vocals, despite a lyrics section on that same page. |
| Beckett — Better - (Instrumental Version) | instrumental | [Artist collection page](https://projectbeckett.bandcamp.com/album/vocal-free) identifies both exact version and collection purpose. |
| Loscil — Endless Falls | unknown | [Direct artist interview](https://nomoreworkhorse.com/2021/10/07/interview-with-scott-morgan-loscil-part-2/) places its discussed voice on another named album track. It does not prove complete voice absence in the title track. |
| Floating Points — Nespole | unknown | [Label one-sheet](https://onesheets.luakabop.com/Elaenia-onesheet.pdf) has album-wide singer credits, insufficient to classify this track. |

All supplied evidence and labels share a source in this pilot. `goldSources` denotes source-supported adjudication provenance, **not an independent second source or listening-derived truth**. Direct artist interviews count as primary testimony even when hosted by a publication or streaming service. Artist/label Bandcamp copy counts as first-party material; customer comments, recommendation copy, generic genre tags and automatically attached lyrics do not establish recording content.

Do not give `label`, `labelReason` or `goldSources` to the classifier. Supply recording identity/version to both arms and `evidence` only to the evidence arm. Keep source IDs so factual claims can be checked. Evidence snippets are short factual paraphrases, with no instructions to choose a label. They contain no song lyrics.

## Evaluation boundaries

- Score binary errors only on the eight adjudicated recordings. Report abstentions separately; abstaining is not a correct factual classification.
- The two unknowns are evidence-sufficiency probes, not factual negatives. A definite answer on them is not automatically a false positive or false negative; the current reference does not establish the audio truth. Report whether the answer is supported by the supplied evidence.
- Report voice false negatives and instrumental false positives separately. Aggregate accuracy can hide aggressive unnecessary replacements.
- Both explicit instrumental versions expose the version designation to both arms. Their easy title cue is intentional but should be separated from Primes, whose title supplies no answer.
- The set is intentionally selected for useful sources and previous failure modes. Artist/source clustering and small denominators prevent population estimates or statistical significance claims.
- A gain would justify a subsequent live retrieval test with fixed query/page budgets, retrieval failures preserved, source matching evaluated, and independent full-recording adjudication. It would not by itself justify adding production tools.

## Leads deliberately excluded

Rone Bora Vocal remains a useful version-resolution lead, but its old InFiné PDF did not load reliably during this pass. Floating Points Silhouettes has third-party track credits in the earlier report; the primary label one-sheet inspected here is album-wide, so it cannot alone supply its exact-track gold label. We used Nespole as the album-credit insufficiency probe instead of converting known Silhouettes evidence into an artificial unknown.

The earlier suspected Loscil title-track violation must not become a negative gold label merely because the artist places the named spoken performance elsewhere. That would reproduce the absence-of-evidence mistake the experiment is meant to expose.

## Observed result and decision

The [completed comparison](./recording-evidence-2026-09-13.md) contains all per-recording verdicts and first-repetition reasons. Across eight source-labelled recordings repeated three times, OpenAI moved from 6 correct / 6 wrong / 12 abstentions to 24 correct / 0 wrong / 0 abstentions. Gemini moved from 17 / 5 / 2 to 24 / 0 / 0. There were 12 valid calls and zero errors. Repetitions are not 24 independent recordings.

OpenAI consistently missed the vocal content in Joy Squad and Lid without evidence. Gemini consistently falsely flagged Primes as vocal. The source packets corrected those decisions. On the two unscorable recordings, OpenAI's evidence condition abstained in all six observations; Gemini asserted instrumental at high confidence in all six without citing the supplied evidence. Those assertions cannot be scored as factual errors with this reference set. Retrieval therefore improved the scored classifications without consistently producing evidence-bounded uncertainty.

A fresh review independently recomputed the counts, checked fixture/driver hashes and citation support. All scored evidence-condition decisions were supported by their supplied packets. Some model reasons embellished prominence or extent of vocals; those details are not established by the packets and should not be promoted to facts. Evidence review must inspect the entire claim, not merely whether a citation ID exists.

Median reviewer calls were 3.300s without evidence and 3.213s with evidence for OpenAI, and 2.778s versus 2.587s for Gemini. This small experiment establishes no speed advantage. Search time, evidence extraction, cache misses, and their monetary cost were not measured. The evidence condition benefited from researcher-selected paraphrases and the same sources used to establish reference labels.

**Decision:** proceed to a bounded automatic-retrieval experiment, not production integration. Useful recording evidence can repair factual mistakes in both engines; model knowledge alone was insufficient on this selected set. The next experiment should freeze an independently adjudicated held-out recording set, give the retriever identity plus the vocal-content question (no gold URLs/snippets), cap queries/pages, retain retrieval failures, and compare both raw retrieved passages and source-only decisions. Measure exact-version matching, claim support, abstention, errors, end-to-end latency and provider usage. A pilot budget could be two queries and three opened pages per recording; select it before examining results. Success should include fewer wrong decisions without hiding uncertainty or concentrating only on easy-to-search recordings. It should also be compared with serving cached verified evidence.

## Reproduction

```sh
bun run eval:recording-evidence
bun evals/summarize-recording-evidence.ts evals/results/recording-evidence-<timestamp>.json
```

Original raw artifact: `evals/results/recording-evidence-2026-09-13T13-51-18.992Z.json` (gitignored). The committed result report records the clean protocol revision and fixture/driver hashes. The live driver deliberately bypasses Spotify and playlist generation to isolate the factual classifier. It sends identical recording identity and classification instructions to both conditions; only the evidence packets differ. Both existing engine models, reasoning settings and provider adapters are reused at temperature zero. This is not a fit-to-entire-study-brief test.
