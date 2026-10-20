# Curation improvements from the 2026 prior-art audit

Status: ready-for-agent

## Problem Statement

A listener who writes a brief for well-known music, such as "best 80s disco
hits", while the purpose is Discover gets deep cuts instead: the popularity
budget allows Adventurous only three mainstream recordings and the novelty
budget keeps known tracks out, so the playlist contradicts the brief.

A listener whose taste sits outside Last.fm's mostly Western user base is
served worse than others. A recording no source counts is treated as not
mainstream, so a large non-English hit passes as obscure under a ceiling, and
under the For a room floor it is the first recording swapped out, because its
nearness to the threshold scores zero.

A listener asking for a narrow scene (for example "Icelandic post-punk") can
get an almost empty candidate pool. Generation then falls back to the
curator's memory alone, with no attempt at a broader but still faithful
lookup and no indication that it happened.

Search does not pass the listener's market, so a pick can resolve to a
recording the listener cannot play. The app also asks for a public-playlist
scope it never uses and stores a preview URL Spotify no longer supplies.

The eval harness cannot see several of these failures: it reports
"on Spotify" without separating exact recording identity from fuzzy matches,
does not report how often picks resolve on the first search, has no cases
that probe non-English or non-Western scenes or canon requests, and has no
robustness checks on the judge.

## Solution

- The intent recognises a **classics request** when the brief literally asks
  for well-known music. It lifts the mainstream ceiling and the known-track
  cap for that generation, and an intent chip says so with an undo that
  regenerates without it.
- Deezer's track rank becomes a third listener source. A recording that no
  source counts is **unknown**: it counts toward neither side of the
  popularity budget and is never swapped out to meet one.
- When the scene lookups return a thin candidate pool, the app makes one
  broader lookup for soft preferences only, and an intent chip names what was
  widened. Hard rules are never widened.
- Search is restricted to the listener's market; the unused scope and the
  stored preview URL are removed; the README documents how Spotify
  identifiers are used as evidence lookup keys.
- The eval harness gains first-try resolution, exact-versus-fuzzy grounding,
  coverage and bias columns, bias-probe cases, and judge robustness checks.

## User Stories

### Classics request

1. As a listener, I want a brief that asks for hits or classics to get
   well-known recordings even when the purpose is Discover, so that the
   playlist matches what I wrote.
   - AC1.1: A brief containing wording such as "best … hits", "classics",
     "greatest", "essential" or "anthems" produces an intent whose classics
     request carries the supporting quote in the brief's own spelling.
   - AC1.2: With a classics request, the popularity budget has no mainstream
     ceiling at any creativity.
   - AC1.3: With a classics request under Discover, the novelty budget does
     not cap known tracks or known artists; the budget event reports
     `uncapped`.
   - AC1.4: Without a classics request, budgets are exactly as today.
2. As a listener, I want the app to say when it treated my brief as a
   classics request, so that I understand why familiar songs appear.
   - AC2.1: The intent chips show a "Classics request" chip whose tooltip is
     the supporting quote.
   - AC2.2: No chip is shown when the intent has no classics request or the
     intent read failed.
3. As a listener, I want to undo the classics reading, so that a wrong guess
   costs me one click.
   - AC3.1: The chip offers an undo that starts a new generation with the
     same brief and settings and the classics request switched off.
   - AC3.2: The undone generation's intent has no classics request and its
     budgets match a brief without one; no chip is shown.
   - AC3.3: The original playlist and generation are kept, as with any
     Generate another.
4. As a listener, I want an unsupported classics reading discarded, so that
   the reader model cannot invent it.
   - AC4.1: A classics request whose quote is not a literal substring of the
     brief is dropped by grounding, as an unsupported album request is.
   - AC4.2: A brief that only names a genre or era ("80s disco") has no
     classics request.
5. As a listener, I want hard rules to keep applying in a classics request,
   so that "classic rock without vocals" still has no vocals.
   - AC5.1: Exclusions, the vocal rule, must-include artists, era and caps
     are unaffected by a classics request.
   - AC5.2: Purpose For a room keeps its mainstream floor; Comfort is
     unchanged.

### Unknown popularity

6. As a listener, I want widely played recordings that Last.fm does not
   count to be recognised as mainstream, so that my scene is not treated as
   obscure.
   - AC6.1: Evidence reads Deezer's rank from the existing track-by-ISRC
     lookup and records it as a listener fact with source `deezer`.
   - AC6.2: Listener sources are asked in the order Last.fm, ListenBrainz,
     Deezer; the first that counts the recording is used.
   - AC6.3: Deezer has its own mainstream threshold, set from eval evidence
     and documented beside the others with the percentile and example
     recordings it was chosen from.
7. As a listener, I want a recording no source counts to be left alone by
   the popularity budget, so that missing data never decides what stays.
   - AC7.1: A recording's mainstream status is one of mainstream, not
     mainstream, or unknown.
   - AC7.2: Unknown recordings count toward neither the ceiling nor the
     floor.
   - AC7.3: Unknown recordings are never evicted to meet a ceiling or a
     floor, and an unknown pool recording is never taken as a budget
     replacement.
   - AC7.4: When the budget cannot be met without touching unknown
     recordings, the popularity event reads `breached`, as when the pool
     cannot supply a replacement today.
   - AC7.5: In the candidate round, an artist with no listener count is
     neither held back by a ceiling's share nor prioritised under a floor.
8. As a listener, I want rerank to know a count is missing rather than low,
   so that it does not reason about unknown songs as deep cuts.
   - AC8.1: Rerank input marks each recording mainstream, not mainstream or
     unknown, and the rerank instructions describe all three.
   - AC8.2: The popularity event reports unknown recordings separately, as
     the summary already does.

### Widening a thin candidate pool

9. As a listener, I want a narrow scene that finds too few candidates to be
   searched once more more broadly, so that the playlist is still grounded in
   real artists.
   - AC9.1: When the scene lookups yield fewer candidates than a fixed
     threshold, the app makes exactly one widened lookup round.
   - AC9.2: The widened round comes from one extra scene-plan request that
     receives the original plan and the fact that it found too few
     candidates; the request contains no Spotify content.
   - AC9.3: Widening may broaden scene and area (for example a country to
     its region) and genres (a subgenre to its parent), and may extend the
     era by at most five years at each end.
   - AC9.4: Widening never changes the vocal rule, exclusions, must-include
     artists or language; a widened plan that touches them is discarded.
   - AC9.5: Widened candidates are merged after the original ones, with the
     usual one-per-artist and exclusion filtering.
   - AC9.6: If the widened round fails or also finds too few, generation
     continues as today, on whatever was found plus the curator's knowledge.
10. As a listener, I want to see when my brief was widened, so that I can
    tell the app did not quite find what I asked for.
    - AC10.1: The intent chips show a "Widened to …" chip naming the widened
      scene, genre or era.
    - AC10.2: No chip appears when no widening happened or the widened round
      contributed no candidates.
11. As a listener, I want replacement and repair to stay strict, so that
    widening never sneaks into slots that broke a rule.
    - AC11.1: Replacement, repair and budget swaps use the original intent,
      never the widened plan.

### Spotify compliance and hygiene

12. As a listener, I want every recording to be playable where I live, so
    that the playlist does not contain greyed-out tracks.
    - AC12.1: Every track search made with the listener's token is
      restricted to the listener's market.
    - AC12.2: Searches made with a client-credentials token (the eval) use
      an explicit configured market, since a token-derived market needs a
      user token.
    - AC12.3: A search result Spotify marks as not playable is not accepted
      as a resolution.
13. As a listener, I want the app to ask only for the Spotify permissions it
    uses, so that I can trust what I grant.
    - AC13.1: The public-playlist modify scope is no longer requested, and
      the scope list no longer mentions it.
    - AC13.2: Playlist creation and adding items still work with the private
      scope alone.
14. As a listener, I want the app to keep no Spotify data it does not use.
    - AC14.1: The preview URL is no longer read, stored or sent to the
      client, and a migration drops its column.
15. As a maintainer, I want the README to state how Spotify identifiers are
    used, so that the policy boundary is explicit.
    - AC15.1: The Spotify Developer Policy section says that a recording's
      ISRC, title, album and duration are used as lookup keys against open
      databases, and that only the open databases' facts reach engine
      requests.
    - AC15.2: The content-boundary test still passes unchanged.

### Eval harness

16. As a maintainer, I want to know how often picks resolve on the first
    search, so that I can see curator recall quality separately from the
    retry and replacement machinery.
    - AC16.1: Each run result records, per engine and case, picks resolved
      on the first search, on the plain-text retry, and by replacement.
    - AC16.2: The console summary and Markdown report show the first-try
      rate.
17. As a maintainer, I want exact recording identity separated from fuzzy
    matches, so that "on Spotify" does not overstate grounding.
    - AC17.1: The report shows exact or normalized resolutions separately
      from fuzzy ones, beside the existing on-Spotify rate.
18. As a maintainer, I want coverage and bias columns, so that I can see
    whose music a prompt change serves.
    - AC18.1: The report shows, per case, the share of artists by country
      and language where MusicBrainz knows them, the first-release-year
      spread, the long-tail share (not mainstream or unknown), and the count
      of unknown and Deezer-counted recordings.
    - AC18.2: The report shows the number of distinct artists across all
      cases in the run.
    - AC18.3: These columns are report-only and never fail the command.
19. As a maintainer, I want cases that probe known weak spots, so that a
    change that fixes them shows up in the eval.
    - AC19.1: The case set adds a non-English rap brief, a non-Western scene
      brief, and a classics-request brief under Discover.
    - AC19.2: The classics case's criteria check that recordings are widely
      known; the scene cases' criteria check scene fidelity and that the
      description does not call a mainstream non-English scene niche,
      regional or "world".
20. As a maintainer, I want to know whether the judge's verdicts depend on
    order or wording, so that I know how far to trust them.
    - AC20.1: An opt-in mode re-judges a saved run with the track order
      shuffled and with the description paraphrased and padded, and reports
      verdicts that changed.
    - AC20.2: The mode reads saved results and calls only the judge.
21. As a maintainer, I want to know whether candidates influence the
    curator, so that the candidate round earns its latency.
    - AC21.1: An opt-in mode replaces the candidate pool with candidates
      from an unrelated case and reports how many final picks still match
      the real pool versus the swapped one.

## Implementation Decisions

### Classics request

- Extend the intent with an optional classics request holding the
  supporting quote, read by the existing intent reader and grounded by the
  same literal-substring rule as the album request. It is a soft preference
  in glossary terms, not a hard rule.
- Generation settings gain an optional override that forces the classics
  request off. The undo action creates a new generation with that override
  through the existing Generate another path; generation settings stay
  immutable.
- The popularity budget takes the intent's classics request into account:
  with it, the ceiling is null at every creativity and For a room's floor is
  unchanged. The novelty budget for Discover becomes uncapped with it.
- The curator instruction for a classics request says the listener wants
  well-known recordings of the brief's scope, and the creativity clause
  still governs how far beyond the most obvious ones to go.
- Add **Classics request** to the domain glossary.

### Unknown popularity

- Add Deezer to the listener sources, read from the rank already present on
  the track-by-ISRC response that evidence fetches for tempo and gain, so no
  new request is made.
- Replace the boolean mainstream test with a three-way status. Budget
  counting, eviction ordering, replacement acceptance, candidate sampling
  and the rerank input all use the three-way status.
- The Deezer threshold is chosen by running the eval and inspecting rank
  values for recordings already judged mainstream or scene staples, as the
  Last.fm threshold was; record the evidence in the threshold's comment.
- The popularity event's counts gain the unknown and per-source counts
  where they are not already present; older saved results without them
  still parse.

### Widening

- Widening lives in the candidate round. It triggers on a fixed minimum
  candidate count, sized against the offered sample and track count.
- The widened plan is requested with the same scene-plan schema plus the
  original plan and a reason the app writes. The app compares the widened
  plan with the intent and discards it if it alters any hard rule or the
  language, or extends the era past five years at either end.
- The candidates event records whether widening ran, the widened plan, what
  it found, and a short listener-facing label for the chip.
- Replacement, repair and budget swaps keep reading the original intent.

### Compliance and hygiene

- The market passed to search depends on the token. A listener token uses
  the token-derived market; the eval's client-credentials token uses a
  market from configuration.
- Resolution rejects a result explicitly marked not playable; a result
  without that field is accepted as today.
- Remove the public-playlist scope and its stated reason; existing
  sessions keep working because a narrower grant is a subset.
- Drop the preview URL from the recording shape, the database schema (with a
  migration) and the client payload.

### Eval harness

- Resolution already records a tier per recording; the run result adds the
  attempt that produced it (first search, retry, replacement) so the report
  can derive first-try rates.
- Coverage columns read evidence the run already gathers (MusicBrainz
  artist country and language, first release date, listener counts); no new
  provider calls.
- Robustness and candidate-swap modes are separate opt-in commands over
  saved results, following the existing compare-vocal-repairs command.

## Testing Decisions

- The highest seam is a full generation against the fake providers at the
  fetch boundary, as in the content-boundary and checkpointed-pipeline
  tests. Classics, unknown popularity, widening and market restriction are
  each verified there through the streamed events and the final playlist:
  - a classics brief under Discover keeps more than three mainstream
    recordings and reports an uncapped novelty budget;
  - a For a room playlist whose recordings have no Last.fm count but a high
    Deezer rank keeps them; one with no count anywhere keeps them and reads
    breached when the floor cannot be met;
  - a scene plan whose lookups find too few artists triggers exactly one
    widened plan request, its candidates appear after the originals, and a
    widened plan that drops an exclusion is discarded;
  - every recorded search request carries the market parameter, and a
    not-playable result is not resolved.
- Pure functions keep their existing unit seams: grounding in the intent
  tests (classics quote kept only when literal), budgets and three-way
  status in the popularity tests, chips in the intent-chip component tests
  (classics and widened chips, undo action).
- The content-boundary test must keep passing; the widened plan request is
  added to the requests it inspects.
- The fake Deezer track gains a rank field so evidence tests cover the new
  source.
- Eval report changes are tested on saved-result fixtures, following the
  existing eval-listener test; no live engine calls in the test suite.
- Behaviour changes to curation (classics, Deezer threshold, widening) are
  compared on the live eval against the current baseline on the same cases,
  engines and judge before release, across at least two runs.

## Out of Scope

- Judge calibration against human labels, a second cross-family judge and
  in-context judge examples.
- Scheduled refresh of a saved brief, shareable brief links, hiding
  per-track reasons, suggested-brief chips.
- Multi-query candidate expansion and entity disambiguation of named works
  before planning; both are eval experiments first.
- Passing reference songs in the brief to the curator as anchors.
- Widening during replacement, repair or budget swaps.
- Any use of Spotify catalogue or listening data in prompts, ranking models
  or training.
- Personalization ablations and multiple listener personas in the eval.

## Further Notes

- Sources are summarised in the audit that produced this spec: Zvuk's
  query-taxonomy study (canon briefs, 58% of queries, adaptive personalization
  preferred in a blind Elo test), Sguerra et al. on LLM taste-profile bias
  (non-English scenes framed as niche), Melo (thin-pool relaxation; 23% of
  recovered sessions had dropped the core constraint, hence the hard-rule
  guard and visible chip), and Spotify's February 2026 Web API changes.
- The domain glossary's **Candidate** and **Taste anchors** entries describe
  candidates from a Spotify search and top Spotify artists offered to the
  curator. Both contradict the README's policy boundary and the current code,
  which offers MusicBrainz and Last.fm artists and never sends Spotify data
  to an engine. Correct the glossary while adding Classics request.
- Release follows the personal-project policy: local verification and eval
  comparisons first; CI is currently manual-dispatch and Vercel git
  deployments are disabled in the working tree.
