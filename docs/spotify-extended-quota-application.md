# Spotify extended quota application

What to submit to Spotify for Music Gippity, and what the previous rejection
was about. Keep the answers here in sync with `/privacy`, `/terms` and
`src/lib/spotify-scopes.ts`; Spotify reads the live app against the form.

## How the process works (as of September 2026)

- Every new app starts in **Development Mode**: five allow-listed users, one
  client id per developer, Premium accounts only.
- The dashboard app page has no "apply" button any more. Extended quota is
  requested through Spotify's Google Form, linked from
  [Quota modes](https://developer.spotify.com/documentation/web-api/concepts/quota-modes),
  and only after that form is approved does a *Quota extension Request* tab
  appear on the app in the dashboard.
- Since 15 May 2025 the extension is granted **only to organisations**: a
  legally registered business, a launched service, at least 250 000 monthly
  active users, and a company email address on the form. Personal and hobby
  projects stay in Development Mode. Review takes up to six weeks.

Music Gippity is a personal project with one Spotify account behind it, so it
does not meet the organisation and audience criteria today. The steps below
are what the form needs when it does, or when Spotify reopens the extension
to individuals.

## Why the last application was rejected

The Developer Policy (section III.14) says: *"Do not use the Spotify Platform
or any Spotify Content to train a machine learning or AI model or otherwise
ingest Spotify Content into a machine learning or AI model."* Spotify Content
covers catalogue metadata, playlists and user data.

The earlier build did ingest Spotify Content into the models:

- the listener's top artists were fetched and named to the curator as
  "taste anchors";
- the listener's known artists were listed in the prompt;
- Spotify search results were passed to the curator as candidates;
- rerank and vocal-review calls sent the Spotify-resolved title, album and
  id of every track.

All of this was removed on the `feat/spotify-policy-compliance` branch. The
models now only ever see the brief, the settings, their own picks and open
database evidence. A test (`tests/spotify-content-boundary.test.ts`) fails the
build if a Spotify string reaches an engine request.

## Answers for the form

Fill in the fields with these texts. Company and contact fields must be the
applicant's real registered details.

**App name**: Music Gippity

**App / website URL**: https://music-gippity.vercel.app

**Privacy policy URL**: https://music-gippity.vercel.app/privacy

**Terms of service URL**: https://music-gippity.vercel.app/terms

**Short description of the app (what it does for the user)**

> Music Gippity turns a short text brief ("rainy Sunday bossa nova",
> "90s UK garage for a house party") into a playlist in the user's own
> Spotify account. The user writes the brief, picks a mood, track count and
> creativity level, and the app streams a list of suggested songs with a
> one-line reason for each. The user can remove or replace songs, then save
> the result as a private playlist in their Spotify account with one click.

**How the app uses the Spotify platform**

> Spotify is used for three things only: signing the user in, resolving the
> suggested artist and song names to Spotify tracks (Search and Track
> endpoints) so the playlist can be created, and creating the playlist and
> adding the tracks to it (`POST /me/playlists`,
> `POST /playlists/{id}/items`). Optionally the user can start and pause
> playback of a suggested track from inside the app on their active device.
> The user's top, saved and recently played tracks are read once per
> generation to mark songs they already know in the interface and to keep a
> "discover" playlist from repeating them; this comparison happens in the
> app's own code and the data is discarded afterwards.

**Use of AI / machine learning (how it relates to Spotify Content)**

> The app uses a third-party large language model (OpenAI or Google Gemini,
> chosen by the user) to propose artist and song names from the user's text
> brief. The model receives only the user's brief, the chosen settings, its
> own earlier suggestions, and facts from open music databases (MusicBrainz,
> Last.fm, Deezer, lrclib, ListenBrainz) about those suggestions.
>
> No Spotify Content is ever sent to a model: not catalogue metadata, not
> search results, not track ids or ISRCs, not artwork, not playlists, and not
> the user's listening history or library. Spotify is called only after the
> model has answered, to look the names up and to create the playlist. We do
> not train, fine-tune or otherwise build any model, and we have an
> automated test that fails our build if a Spotify string appears in a model
> request. This was rebuilt specifically to meet section III.14 of the
> Developer Policy after an earlier version of the app was declined.

**Scopes requested and why**

| Scope | Feature |
| --- | --- |
| `user-read-email`, `user-read-private` | Sign in; show who is logged in |
| `playlist-modify-private`, `playlist-modify-public` | Create the generated playlist in the user's account |
| `user-modify-playback-state` | In-app play and pause of a suggested track |
| `user-top-read`, `user-library-read`, `user-read-recently-played` | Mark songs the user already knows; keep a discovery playlist off them (compared in-app, never sent to a model, never stored) |

**Data storage**

> We store the user's Spotify id, display name, email, avatar and OAuth
> tokens; the playlists and songs the user created in the app; progress
> data for in-flight generations; and aggregate AI token counts. We do not
> store the user's listening history or library. *Disconnect Spotify* on the
> account page deletes every record for the account immediately, and users
> can also revoke access from their Spotify account settings. Requests sent
> via GitHub issues are honoured within five days.

**Attribution and branding**

> Every track and playlist shown in the app carries the Spotify logo and a
> "Listen on Spotify" link to the item on open.spotify.com. Album artwork is
> shown unmodified with the required corner radius. AI-written text (the
> playlist description and per-song reasons) is labelled "AI curator" so it
> is not mistaken for Spotify editorial content. The app uses the official
> Spotify logo assets and does not use Spotify's name in its own name or
> logo.

**Monetisation**: none. The app is free and has no ads, and no Spotify data
is sold or shared.

**Expected usage / markets**: fill in honestly. The form asks for monthly
active users and launch markets; the current answer is a handful of
allow-listed users, which is below the threshold.

## Dashboard settings to keep aligned

- App description in the dashboard (Basic Information), 256 characters max:
  "Turns a short text brief into a private playlist in the user's Spotify account. An AI model proposes song names from the brief only; Spotify then resolves them and creates the playlist. No Spotify content or user data reaches any AI model." (saved 2026-09-23)
- Website: https://music-gippity.vercel.app
- Redirect URIs: the production callback plus two Vercel preview callbacks; unchanged.
- User Management: the allow-listed testers.
