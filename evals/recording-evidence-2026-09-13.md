# Recording evidence results
Experiment calls: 12/12 (complete).

Source revision: `2ef88a86f4ccde8e1b7e659bbb59506bb29548c0`; dirty: false.
Fixture SHA-256: `78dbad56d17abd2128e55f153f78d90c9a2bf31a167175e03ab4ced2ac0bea8d`.
Driver SHA-256: `20def606d69c25a712151222065f5f98e4e616e14b0664b92f23d6e5945f7d58`.

Three repeated classifications of each recording are repeated observations, not independent tracks. Correctness means agreement with frozen source-supported labels, not listening-established truth. Unknown reference labels are excluded from correctness totals. Wrong excludes abstentions; missing includes invalid calls. Timings measure reviewer calls only, excluding source retrieval and curation.

| Engine | Condition | Opportunities | Correct | Wrong | Abstain | Missing | Vocal missed as instrumental | Instrumental flagged vocal | Median call ms |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| chatgpt | knowledge | 24 | 6 | 6 | 12 | 0 | 6 | 0 | 3300 |
| chatgpt | evidence | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 3213 |
| gemini | knowledge | 24 | 17 | 5 | 2 | 0 | 2 | 3 | 2778 |
| gemini | evidence | 24 | 24 | 0 | 0 | 0 | 0 | 0 | 2587 |

## Per-recording verdicts

V = vocals, I = instrumental, U = uncertain. Each cell lists repetitions in order; confidence follows each verdict. Unknown reference cases have no established binary truth.

| Recording | Reference | OpenAI knowledge | OpenAI evidence | Gemini knowledge | Gemini evidence |
|---|---|---|---|---|---|
| Koreless — Joy Squad | vocals | I/medium, I/medium, I/medium | V/high, V/high, V/high | V/high, V/high, V/high | V/high, V/high, V/high |
| Koreless — Primes | instrumental | I/medium, I/medium, I/medium | I/high, I/high, I/high | V/high, V/high, V/high | I/high, I/high, I/high |
| Christian Löffler — Haul (feat. Mohna) | vocals | V/high, V/high, V/high | V/high, V/high, V/high | V/high, V/high, V/high | V/high, V/high, V/high |
| Christian Löffler — Lid | vocals | I/medium, I/medium, I/medium | V/high, V/high, V/high | V/high, V/high, I/medium | V/high, V/high, V/high |
| Rosehip — Found | vocals | U/low, U/low, U/low | V/high, V/high, V/high | V/medium, I/medium, U/low | V/high, V/high, V/high |
| Blackdown — Slow It Down | vocals | U/low, U/low, U/low | V/high, V/high, V/high | V/medium, V/medium, U/low | V/high, V/high, V/high |
| The Blake Robinson Synthetic Orchestra — Mania (Instrumental Version) | instrumental | U/low, U/low, U/low | I/high, I/high, I/high | I/high, I/high, I/medium | I/high, I/high, I/high |
| Beckett — Better - (Instrumental Version) | instrumental | U/low, U/low, U/low | I/high, I/high, I/high | I/high, I/high, I/high | I/high, I/high, I/high |
| Loscil — Endless Falls | unknown | I/high, I/medium, I/medium | U/medium, U/low, U/low | I/high, I/high, I/high | I/high, I/high, I/high |
| Floating Points — Nespole | unknown | V/high, V/high, V/high | U/medium, U/low, U/low | I/high, I/high, I/high | I/high, I/high, I/high |

## Reasons from the first repetition

Full responses for all repetitions remain in the raw JSON. These are model claims, not additional verified facts. Citation IDs refer to the frozen fixture.

| Recording | Engine | Condition | Verdict | Confidence | Reason | Evidence IDs |
|---|---|---|---|---|---|---|
| joy-squad | chatgpt | knowledge | instrumental | medium | Known as an electronic instrumental album track; no voice elements are documented in recording knowledge. |  |
| primes | chatgpt | knowledge | instrumental | medium | Known as an electronic instrumental album track; no voice elements are documented in recording knowledge. |  |
| haul | chatgpt | knowledge | vocals | high | This album recording is explicitly credited as featuring Mohna and contains vocals. |  |
| lid | chatgpt | knowledge | instrumental | medium | Known as an instrumental electronic track without documented vocal content. |  |
| found | chatgpt | knowledge | uncertain | low | Insufficient reliable recording-specific knowledge to establish whether it contains vocals or vocal samples. |  |
| slow-it-down | chatgpt | knowledge | uncertain | low | Insufficient reliable recording-specific knowledge to establish absence of sung, spoken, sampled, or wordless vocals. |  |
| mania-instrumental | chatgpt | knowledge | uncertain | low | An instrumental-version title alone does not establish absence of vocal samples or wordless human vocals. |  |
| better-instrumental | chatgpt | knowledge | uncertain | low | Instrumental and vocal-free labeling alone does not establish absence of vocal samples or wordless human vocals. |  |
| endless-falls | chatgpt | knowledge | instrumental | high | Known ambient/electronic title track with no sung, spoken, sampled, or wordless vocal content documented in recording knowledge. |  |
| nespole | chatgpt | knowledge | vocals | high | Contains spoken Italian-language field-recording speech. |  |
| joy-squad | chatgpt | evidence | vocals | high | Track-by-track description says Joy Squad turns vocals into short percussive sounds. | joy-squad-source |
| primes | chatgpt | evidence | instrumental | high | Artist states the track is made only of sine waves. | primes-source |
| haul | chatgpt | evidence | vocals | high | Artist release page identifies Haul as one of the tracks with Mohna vocals. | haul-source |
| lid | chatgpt | evidence | vocals | high | Artist description states Löffler sings on Lid. | lid-source |
| found | chatgpt | evidence | vocals | high | Arrangement includes a vocal sample of Alan Watts. | found-source |
| slow-it-down | chatgpt | evidence | vocals | high | Artist page describes and credits Loopcloud vocal samples. | slow-it-down-source |
| mania-instrumental | chatgpt | evidence | instrumental | high | Artist describes this exact version as the full recording with vocals removed. | mania-instrumental-source |
| better-instrumental | chatgpt | evidence | instrumental | high | Artist describes Vocal Free versions as arrangements without their vocal lines. | better-instrumental-source |
| endless-falls | chatgpt | evidence | uncertain | medium | Source identifies voice only on the album's final track, not this title track; it does not establish absence of vocals here. | endless-falls-source |
| nespole | chatgpt | evidence | uncertain | medium | Album-level vocal credits are not assigned by track, so they do not establish whether Nespole contains vocals. | nespole-source |
| joy-squad | gemini | evidence | vocals | high | Koreless uses processed vocal samples shaped into percussive elements throughout Joy Squad. | joy-squad-source |
| primes | gemini | evidence | instrumental | high | Primes consists solely of synthesized sine waves with no vocal elements. | primes-source |
| haul | gemini | evidence | vocals | high | Haul features prominent vocals performed by Mohna. | haul-source |
| lid | gemini | evidence | vocals | high | Lid features sung vocals performed by Christian Löffler. | lid-source |
| found | gemini | evidence | vocals | high | Found incorporates a spoken vocal sample of Alan Watts. | found-source |
| slow-it-down | gemini | evidence | vocals | high | Slow It Down features vocal samples sourced from Loopcloud. | slow-it-down-source |
| mania-instrumental | gemini | evidence | instrumental | high | Mania (Instrumental Version) is an instrumental recording with all vocal parts removed. | mania-instrumental-source |
| better-instrumental | gemini | evidence | instrumental | high | Better (Instrumental Version) features the synthwave arrangement completely stripped of vocal lines. | better-instrumental-source |
| endless-falls | gemini | evidence | instrumental | high | Endless Falls is an ambient instrumental composition with no vocals or vocal samples. |  |
| nespole | gemini | evidence | instrumental | high | Nespole is an entirely instrumental track composed of synthesizers, Rhodes piano, and acoustic instruments without any vocals. |  |
| joy-squad | gemini | knowledge | vocals | high | Contains heavily processed vocal samples and vocal synth chops throughout. |  |
| primes | gemini | knowledge | vocals | high | Built around intricate, pitched and chopped vocal samples. |  |
| haul | gemini | knowledge | vocals | high | Features prominent sung vocals by Mohna. |  |
| lid | gemini | knowledge | vocals | high | Features recurring wordless vocal sighs and melodic vocal layers by Christian Löffler. |  |
| found | gemini | knowledge | vocals | medium | Features prominent vocal elements and vocal chops typical of Rosehip's chillhop/electronic style. |  |
| slow-it-down | gemini | knowledge | vocals | medium | Features vocal samples consistent with Blackdown's UK garage/dubstep production style. |  |
| mania-instrumental | gemini | knowledge | instrumental | high | An orchestral instrumental version with all vocal tracks removed. |  |
| better-instrumental | gemini | knowledge | instrumental | high | Instrumental synthwave version completely free of vocals from Beckett's 'Vocal Free' release. |  |
| endless-falls | gemini | knowledge | instrumental | high | An ambient, minimalist electronic piece composed of synthesizer pads, sub-bass, and rain/water textures without any vocals. |  |
| nespole | gemini | knowledge | instrumental | high | An entirely instrumental composition featuring Rhodes piano, synthesizer textures, and acoustic instrumentation. |  |

## Errors

None.
