# Music Gippity

Turns a text brief into a Spotify playlist. An LLM proposes songs from the
brief, Spotify resolves them to recordings, and the result is saved as a
private playlist in the listener's account.

Live at <https://music-gippity.vercel.app>. The Spotify app is in Development
Mode, so signing in needs an allow-listed Premium account; see
[docs/spotify-extended-quota-application.md](docs/spotify-extended-quota-application.md)
for what leaving that mode requires.

## Stack

- Next.js (App Router, React Compiler, Turbopack) on Vercel
- tRPC and TanStack Query
- Drizzle ORM on Turso (libSQL)
- Auth.js with the Spotify provider
- Tailwind CSS v4 and Radix UI
- OpenAI and Gemini engines, called over `fetch` from edge routes that stream
  NDJSON to the client. Engine and model ids live in `src/lib/engines.ts`.

## Spotify Developer Policy

Spotify's Developer Policy forbids feeding Spotify Content (catalogue
metadata, playlists, user data) into an AI model. The app's invariant:
**nothing read from Spotify ever enters an engine request**.

- Prompts receive the brief, the settings, the engine's own picks and evidence
  from open databases (MusicBrainz, Last.fm, Deezer, lrclib, ListenBrainz).
  They never receive Spotify titles, ids, ISRCs, artwork or the listener's
  library.
- The listener's top, saved and recent tracks are read only to mark familiar
  songs in the UI and to cap known tracks in a discovery playlist. They are
  compared in the app and discarded.
- OAuth scopes and their reasons are listed in `src/lib/spotify-scopes.ts`.
- Track and playlist views carry the Spotify logo and a *Listen on Spotify*
  link; AI-written text is labelled.
- `/privacy` and `/terms` describe data use. *Disconnect Spotify* on the
  account page deletes everything the app holds about the account
  (`src/server/account-deletion.ts`).

`tests/spotify-content-boundary.test.ts` runs a full generation against a
fake Spotify that answers with sentinel strings and fails if any engine
request body contains one.

## How curation works

Every engine call sends one curator system prompt (persona, no repeated
artists, era and subgenre spread, exact spelling, NDJSON output) plus the
brief. The **creativity** setting (safe / balanced / adventurous) maps to a
temperature and an instruction clause. Reasoning is off on both engines; it
added around 15 s before the first track without improving picks.

Songs Spotify cannot find are retried with a plain-text search and, failing
that, replaced in place by a substitute from the same engine.

A *Discover* playlist offers the curator candidates from MusicBrainz (artists
by tag, area and label) and Last.fm charts. The listener's known tracks then
filter those candidates and cap how many known tracks and artists remain.

When a brief asks for no vocals, the resolved recordings are reviewed after
generation: Gemini flags confident vocal violations and proposes substitutes,
OpenAI checks each substitute for vocals and fit, and only substitutes that
pass both replace the original. This is a model-knowledge check, not audio
verification.

## Local development

```sh
bun install
bun run dev        # starts a local Turso instance and next dev on :3025
```

```sh
bun run check      # biome lint + format
bun run typecheck
bun run test       # providers faked at fetch
bun run build
bun run eval       # live curator eval against real engines; see evals/README.md
```

## Environment

`src/env.mjs` is the schema. Copy `.env.example` and fill in:

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Auth.js |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify developer app |
| `OPENAI_KEY`, `OPENAI_ORGANIZATION_ID` | OpenAI engine |
| `GEMINI_API_KEY` | Gemini engine |
| `LASTFM_API_KEY` | Optional; Last.fm evidence is off without it |
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | Database |

Database scripts (`db:generate`, `db:push`, `db:migrate`, `db:studio`) read
`.env.production`.

## Evaluation

`bun run eval` runs eight authored briefs through both engines and has a
fixed Gemini judge grade every track. Method, flags, caveats and the
experiment write-ups are in [evals/README.md](evals/README.md).

## License

MIT, see [LICENSE](LICENSE). The Spotify logo files under
`public/assets/spotify` are Spotify trademarks used under its design
guidelines and are not covered by the MIT licence.
