# Music Gippity

Turns a listener's text brief into a Spotify playlist through an LLM curator, then checks and repairs the result against what the listener asked for.

## Language

### Asking

**Brief**:
The listener's free-text request for a playlist, exactly as written or as assembled by the wizard.
_Avoid_: prompt (the rendered LLM input), query, request

**Intent**:
The structured reading of a brief: genres, era, mood or activity, energy, language or scene, vocal rule, exclusions, must-include artists, album request.
_Avoid_: constraints, tags, criteria, filters

**Hard rule**:
An intent field a recording must satisfy to stay in the playlist, such as the vocal rule, the era, or an exclusion.
_Avoid_: filter, constraint

**Difficulty**:
The intent's flag that a brief needs verified recordings: set when it has an exclusion, a language or scene, or a no-vocals rule.

**Soft preference**:
An intent field that guides selection and order without disqualifying a recording, such as mood, energy, or scene share.

**Creativity**:
The listener's safe, balanced, or adventurous setting; it decides how far picks may stray from the obvious.
_Avoid_: temperature (an implementation of creativity), discovery level

**Taste anchors**:
The listener's top Spotify artists, offered to the curator as context to anchor to, never to copy.
_Avoid_: personalization data, listening history, favourites

### Curating

**Playlist**:
A listener's named, ordered collection of recordings, with its own identity and retained contents independent of the attempt that built it.

**Generation**:
One attempt to build a playlist from a listener's brief, with its own identity and retained progress. A generation continues independently of the listener viewing it; trying again creates a new generation without replacing the previous one.

**Generation phase**:
The current part of building a playlist, such as interpreting intent, retrieving candidates, resolution, repair or rerank; distinct from whether the attempt is running, completed, failed or cancelled.

**Generation checkpoint**:
A confirmed result of a generation phase that later work can reuse without repeating that completed part of curation.

**Curator**:
The LLM persona that proposes picks, replacements, and listening order.
_Avoid_: model, assistant, generator

**Engine**:
A configured LLM provider and model that the curator runs on.
_Avoid_: provider, backend

**Pick**:
An artist and title the curator names from memory, before Spotify confirms the recording exists.
_Avoid_: suggestion, song, track

**Candidate**:
A recording found by a curator-written Spotify search before generation and offered to the curator as verified available.
_Avoid_: pool (that is post-generation), option

**Slot**:
A position in the playlist that keeps its identity across replacement so the listener's row updates in place.
_Avoid_: index, row, position

**Cap**:
A limit on what filled slots may repeat: one per artist including credited artists, one per Spotify ID, one per ISRC, and one per album unless the intent asks for an album.
_Avoid_: dedupe, uniqueness check

**Origin**:
Where a slot's song came from: pick, pool, replacement, or repair.
_Avoid_: source, provenance

### Resolving

**Recording**:
A specific Spotify track that a pick resolved to, identified by Spotify ID and ISRC.
_Avoid_: song, track (when identity matters), match

**Resolution**:
Matching a pick to a recording; every resolution has a tier: exact, normalized, fuzzy, or unresolved.
_Avoid_: lookup, search hit, enrichment

**Version drift**:
A resolution whose recording is a different version of the pick, such as a live take, remix, remaster, or vocal mix.
_Avoid_: mismatch, wrong track

**Pool**:
Resolved recordings generated beyond the requested count and held as ready replacements.
_Avoid_: extras, spares, buffer

**Replacement**:
A recording that takes over a slot whose recording was unresolved, violated a hard rule, or was pruned.
_Avoid_: substitute, swap, fallback

### Checking

**Evidence**:
Externally sourced facts about a recording, each with its source: original release date, artist credit, instrumental flag, tempo, tags, listener counts.
_Avoid_: metadata (Spotify's own fields), features, signals

**Repair**:
Replacing a recording that evidence or review shows violates a hard rule, after the playlist has streamed.
_Avoid_: fix, cleanup, post-processing

**Rerank**:
The curator's final pass over resolved recordings that sets listening order, prunes misfits, and gives each recording a reason.
_Avoid_: reorder, sort, refinement

**Reason**:
The one-line explanation of why a recording belongs in the playlist, shown to the listener.
_Avoid_: why, rationale, justification

### Evaluating

**Case**:
A frozen brief with its creativity, track count, and criteria, run through the curator to measure quality.
_Avoid_: scenario, test, sample

**Judge**:
A fixed engine that assesses a finished playlist against its brief and criteria, without seeing which engine curated it.
_Avoid_: evaluator, grader, reviewer
