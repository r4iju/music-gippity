import { v4 as uuidv4 } from "uuid";
import {
	type PlaylistFormInput,
	PlaylistFormSchema,
} from "~/app/dashboard/create-playlist/playlist-form-schema";
import type { Song, SourcedSong } from "~/contexts/playlist-provider";
import { artistKey, SlotCaps, takeFromPool } from "~/lib/caps";
import { CREATIVITY } from "~/lib/creativity";
import type { Evidence } from "~/lib/evidence";
import type { Intent } from "~/lib/intent";
import {
	type CandidateSource,
	CuratorLineSchema,
	type PlaylistLine,
	PlaylistLineSchema,
	type SongOrigin,
	type SongSource,
} from "~/lib/playlist-stream";
import { popularityBudget } from "~/lib/popularity";
import { type Resolution, UNRESOLVED } from "~/lib/resolution";
import { searchForCandidates } from "~/server/api/candidates";
import { runEngine } from "~/server/api/engines";
import {
	curatorSystemPrompt,
	playlistPrompt,
} from "~/server/api/engines/common";
import { gatherEvidence } from "~/server/api/evidence";
import { readIntent } from "~/server/api/intent";
import { familiarityOf, fetchKnown, type KnownSet } from "~/server/api/known";
import { type Listener, spotifyListener } from "~/server/api/listener";
import {
	budgetEvent,
	enforceNoveltyBudget,
	noveltyBudget,
} from "~/server/api/novelty";
import {
	enforcePopularityBudget,
	popularityEvent,
} from "~/server/api/popularity";
import { repairFromEvidence } from "~/server/api/repair";
import { suggestReplacement } from "~/server/api/replacement";
import { otherEngine, rerankPlaylist } from "~/server/api/rerank";
import { findSpotifyTrack } from "~/server/api/spotify";
import { processEngineStream } from "~/server/api/stream-helpers";
import { repairVocalTracks } from "~/server/api/vocal-repair";
import { auth } from "~/server/auth";
import { avoidedArtists } from "~/server/generation/research";
import { logger } from "~/utils";

type StreamedSong = {
	kind: "song";
	id: string;
	order: number;
	artist: string;
	title: string;
	source: SongSource;
};

type Slot = Pick<StreamedSong, "id" | "order">;

/** A slot the stream left unfilled, and what it shows if nothing fills it. */
type EmptySlot = { slot: Slot; kept: SourcedSong | null };

type Enrichment =
	| { status: "found"; song: SourcedSong }
	| { status: "missing"; song: SourcedSong }
	// Spotify itself failed (rate limit, outage): the pick may well be real,
	// so it must not be treated as a hallucination and swapped out.
	| {
			status: "failed";
			song: StreamedSong & { songId: null; resolution: Resolution };
	  };

export async function enrichSongWithSpotify(
	song: StreamedSong,
	spotifyToken: string,
	intent: Intent | null,
): Promise<Enrichment> {
	try {
		const enriched = await findSpotifyTrack({
			song: {
				id: song.id,
				order: song.order,
				artist: song.artist,
				title: song.title,
			},
			token: spotifyToken,
			intent,
		});
		const merged = { ...song, ...enriched };
		return { status: merged.songId ? "found" : "missing", song: merged };
	} catch (err) {
		logger.error("Error enriching song with Spotify:", err as Error);
		return {
			status: "failed",
			song: { ...song, songId: null, resolution: UNRESOLVED },
		};
	}
}

/** A resolved song moved into a slot, keeping the slot's id and order. */
export const intoSlot = <S extends Song>(song: S, slot: Slot): S => ({
	...song,
	id: slot.id,
	order: slot.order,
});

/**
 * Builds the playlist a request asks for and streams it. The listener's
 * account is read through `listener`, the signed-in Spotify account unless
 * an eval supplies a fixture.
 */
export async function createPlaylist(req: Request, listener?: Listener) {
	const session = await auth();
	if (!session) return new Response("Unauthorized", { status: 401 });
	return generatePlaylistStream(
		await req.json(),
		{
			userId: session.user.id,
			spotifyToken: session.user.accessToken,
			signal: req.signal,
		},
		listener,
	);
}

export async function generatePlaylistStream(
	input: PlaylistFormInput,
	context: {
		userId: string;
		spotifyToken: string;
		signal: AbortSignal;
		playlistId?: string;
	},
	listener?: Listener,
) {
	const cancellation = new AbortController();
	const signal = AbortSignal.any([context.signal, cancellation.signal]);
	signal.throwIfAborted();
	const { spotifyToken, userId } = context;
	const account = listener ?? spotifyListener(spotifyToken);
	const validatedData = PlaylistFormSchema.parse(input);
	const { prompt, trackCount, creativity, engine, purpose } = validatedData;

	const playlistId = context.playlistId ?? uuidv4();
	const budget = noveltyBudget(purpose, trackCount);
	// The known set is read alongside the intent. A capped purpose filters
	// known artists out of the candidate lookups, which then wait for it;
	// otherwise only the songs need it, so it is awaited once the stream
	// starts. It never reaches an engine.
	const knownRead = fetchKnown(account, userId);
	const intent = await readIntent(prompt, signal, userId);
	signal.throwIfAborted();
	const avoidRead = budget
		? knownRead.then((known) => avoidedArtists(known.set))
		: null;
	const search = await (avoidRead ?? Promise.resolve(null)).then((avoid) =>
		searchForCandidates({
			userId,
			signal,
			brief: prompt,
			intent,
			engine,
			trackCount,
			creativity,
			avoid,
			// Drawn for the requested length: nothing has resolved yet.
			popularity: popularityBudget(creativity, purpose, trackCount),
		}),
	);
	signal.throwIfAborted();
	// An artist candidate is matched by any of its songs, and so is a chart
	// track: the curator may pick another take than the chart's.
	const artistSources = new Map<string, CandidateSource>([
		...(search?.artists ?? []).map(
			(artist) => [artistKey(artist.name), artist.source] as const,
		),
		...(search?.tracks ?? []).map(
			(track) => [artistKey(track.artist), track.source] as const,
		),
	]);
	const offered = Boolean(search?.artists.length || search?.tracks.length);
	const matchedCandidate = (song: Song): CandidateSource | undefined => {
		for (const name of [
			song.artist,
			...(song.spotifyRecording?.artists ?? []),
		]) {
			const source = artistSources.get(artistKey(name));
			if (source) return source;
		}
		return undefined;
	};

	const streamOrResponse = await runEngine(engine, {
		userId,
		signal,
		system: curatorSystemPrompt,
		prompt: playlistPrompt({
			prompt,
			trackCount,
			creativity,
			purpose,
			candidateArtists: search?.artists,
			candidateTracks: search?.tracks,
		}),
		temperature: CREATIVITY[creativity].temperature,
	});
	if (streamOrResponse instanceof Response) return streamOrResponse;

	const textEncoder = new TextEncoder();
	const finalSongs = new Map<string, SourcedSong>();
	// Name/description arrive first and are needed for replacement briefs.
	let playlistName = "";
	let playlistDescription = "";
	const accepted: { artist: string; title: string }[] = [];
	const rejected: string[] = [];
	const caps = new SlotCaps(intent);
	// Evidence is fetched as soon as a recording resolves and shared by
	// Spotify ID, so a recording moved between slots is asked about once.
	const evidenceLookups = new Map<string, Promise<Evidence>>();
	const evidenceFor = (song: Song & { songId: string }): Promise<Evidence> => {
		signal.throwIfAborted();
		const key = song.songId;
		let lookup = evidenceLookups.get(key);
		if (!lookup) {
			lookup = gatherEvidence({
				isrc: song.resolution?.isrc ?? null,
				title: song.spotifyRecording?.title ?? song.title,
				artist: song.spotifyRecording?.artists[0] ?? song.artist,
				album: song.albumTitle ?? null,
				durationMs: song.spotifyRecording?.durationMs ?? null,
			});
			evidenceLookups.set(key, lookup);
		}
		return lookup;
	};

	let knownSet: KnownSet | null = null;
	const enrichedStream = new ReadableStream<Uint8Array>({
		cancel() {
			cancellation.abort();
		},
		async start(controller) {
			const emit = (obj: PlaylistLine) => {
				signal.throwIfAborted();
				const line = PlaylistLineSchema.safeParse(obj);
				if (!line.success) {
					logger.warning("Dropped invalid playlist line:", JSON.stringify(obj));
					return;
				}
				if (line.data.kind === "song") {
					line.data.candidate = matchedCandidate(line.data);
					if (knownSet)
						line.data.familiarity = familiarityOf(knownSet, line.data);
					finalSongs.set(line.data.id, line.data);
				}
				controller.enqueue(
					textEncoder.encode(`${JSON.stringify(line.data)}\n`),
				);
			};

			emit({ kind: "id", id: playlistId });
			emit({ kind: "intent", intent, purpose });
			const known = await knownRead;
			knownSet = known.set;
			emit(known.event);
			if (search) emit(search.event);

			// Every filled slot passes through here, so it always has an origin.
			const accept = (song: SourcedSong, origin: SongOrigin) => {
				caps.claim(song);
				accepted.push({ artist: song.artist, title: song.title });
				emit({ ...song, kind: "song", origin });
				if (song.songId) void evidenceFor({ ...song, songId: song.songId });
			};

			// Ask the engine for one replacement for a slot the pool could not
			// fill. `kept` is what the slot shows if the engine has nothing.
			const replace = async (slot: Slot, kept: SourcedSong | null) => {
				signal.throwIfAborted();
				const suggestion = await suggestReplacement(
					engine,
					{
						prompt,
						playlistName,
						playlistDescription,
						currentSongs: accepted,
						avoidedSongs: rejected,
						purpose,
					},
					creativity,
					signal,
					userId,
				);
				// Replacements run concurrently, so hold the artist before the
				// Spotify round trip or two of them could land on the same act.
				const artist = suggestion && artistKey(suggestion.artist);
				if (!suggestion || !artist || caps.heldElsewhere(artist, slot.id)) {
					if (kept) emit({ ...kept, kind: "song" });
					return;
				}
				caps.hold(artist, slot.id);
				const replacement: StreamedSong = {
					kind: "song",
					...slot,
					...suggestion,
					source: "recall",
				};
				emit({ ...replacement, origin: "replacement" });
				const enriched = await enrichSongWithSpotify(
					replacement,
					spotifyToken,
					intent,
				);
				const song = intoSlot(enriched.song, slot);
				if (enriched.status === "found" && caps.conflicts(song)) {
					// The slot goes back to holding what it shows, if anything.
					if (kept?.songId) caps.claim(kept);
					else caps.release(slot.id);
					if (kept) emit({ ...kept, kind: "song" });
					return;
				}
				accept(song, "replacement");
			};

			// The first `trackCount` picks are slots and stream as they resolve.
			// Later picks resolve in the background into a pool that fills any
			// slot the stream leaves empty, so the curator is only asked again
			// once the pool runs dry.
			const poolLookups: Promise<Enrichment>[] = [];
			const empty: EmptySlot[] = [];
			let slotCount = 0;

			const resolveSlot = async (song: StreamedSong) => {
				signal.throwIfAborted();
				const enriched = await enrichSongWithSpotify(
					song,
					spotifyToken,
					intent,
				);
				if (enriched.status === "failed") {
					// The row keeps the pick's artist, so hold that name for it.
					caps.claim(enriched.song);
					emit({ ...enriched.song, origin: "pick" });
					return;
				}
				if (enriched.status === "missing" || caps.conflicts(enriched.song)) {
					rejected.push(`${song.artist} - ${song.title}`);
					// If nothing can fill the slot it shows the pick as unresolved:
					// a duplicate must never land, but the failure stays visible.
					empty.push({
						slot: song,
						kept: {
							...song,
							songId: null,
							resolution: UNRESOLVED,
							origin: "pick",
						},
					});
					return;
				}
				accept(enriched.song, "pick");
			};

			await processEngineStream<Record<string, unknown>>(
				streamOrResponse,
				controller,
				async (obj) => {
					signal.throwIfAborted();
					const parsed = CuratorLineSchema.safeParse(obj);
					if (!parsed.success) {
						logger.warning(
							"Dropped malformed curator line:",
							JSON.stringify(obj),
						);
						return;
					}
					const line =
						parsed.data.kind === "song"
							? {
									...parsed.data,
									// A declaration counts only when something was offered.
									source:
										offered && parsed.data.source === "candidates"
											? ("candidates" as const)
											: ("recall" as const),
								}
							: parsed.data;
					if (line.kind === "name") {
						playlistName = line.name;
						emit(line);
					} else if (line.kind === "description") {
						playlistDescription = line.description;
						emit(line);
					} else if (slotCount < trackCount) {
						slotCount += 1;
						const song: StreamedSong = {
							...line,
							id: uuidv4(),
							order: slotCount,
						};
						emit({ ...song, origin: "pick" });
						await resolveSlot(song);
					} else {
						poolLookups.push(
							enrichSongWithSpotify(
								{ ...line, id: uuidv4() },
								spotifyToken,
								intent,
							).then((entry) => {
								if (
									!signal.aborted &&
									entry.status === "found" &&
									entry.song.songId
								)
									void evidenceFor({
										...entry.song,
										songId: entry.song.songId,
									});
								return entry;
							}),
						);
					}
				},
				signal,
			);
			signal.throwIfAborted();
			for (let order = slotCount + 1; order <= trackCount; order++)
				empty.push({ slot: { id: uuidv4(), order }, kept: null });

			const pool = (await Promise.all(poolLookups)).flatMap((entry) =>
				entry.status === "found" ? [entry.song] : [],
			);
			const unfilled: EmptySlot[] = [];
			for (const entry of empty) {
				const song = takeFromPool(pool, caps);
				if (song) accept(intoSlot(song, entry.slot), "pool");
				else unfilled.push(entry);
			}
			await Promise.all(
				unfilled.map((entry) => replace(entry.slot, entry.kept)),
			);
			for (const { slot } of unfilled)
				if (!finalSongs.has(slot.id))
					logger.warning(`Slot ${slot.order} stays empty: no pick to show`);
			// Each resolved slot streams its evidence, then hard rules are
			// checked from evidence first and only unknown vocal status is left
			// to the LLM review.
			const withEvidence = async (song: SourcedSong): Promise<SourcedSong> => {
				if (!song.songId) return song;
				const evidence = await evidenceFor({ ...song, songId: song.songId });
				emit({ kind: "evidence", id: song.id, evidence });
				return { ...song, evidence };
			};
			const songs = new Map<string, SourcedSong>();
			for (const song of finalSongs.values())
				songs.set(song.id, await withEvidence(song));
			signal.throwIfAborted();
			const grounded = await repairFromEvidence({
				intent,
				songs: [...songs.values()],
				pool,
				caps,
				evidenceFor,
				emit,
			});
			for (const song of grounded.replacements) {
				accept(song, "repair");
				songs.set(song.id, await withEvidence(song));
			}
			// With the pool empty the curator is asked, as before evidence; the
			// violator stays if the curator has nothing either.
			await Promise.all(grounded.unfilled.map((song) => replace(song, song)));
			for (const song of grounded.unfilled) {
				const now = finalSongs.get(song.id);
				if (now && now.songId !== song.songId)
					songs.set(song.id, await withEvidence(now));
			}
			signal.throwIfAborted();
			const repairs = await repairVocalTracks({
				userId,
				signal,
				brief: prompt,
				intent,
				songs: [...songs.values()],
				reviewable: [...songs.values()].filter(
					(song) => song.evidence?.instrumental?.value !== true,
				),
				caps,
				token: spotifyToken,
				emit,
			});
			// A substitute is the reviewer's own suggestion, never a candidate.
			for (const repair of repairs) {
				const song: SourcedSong = { ...repair, source: "recall" };
				emit({ ...song, kind: "song", origin: "repair" });
				songs.set(song.id, await withEvidence(song));
			}
			const swaps =
				budget && knownSet
					? await enforceNoveltyBudget({
							budget,
							set: knownSet,
							intent,
							songs: [...songs.values()],
							pool,
							caps,
							evidenceFor,
						})
					: [];
			for (const song of swaps) {
				accept(song, "novelty");
				songs.set(song.id, await withEvidence(song));
			}
			const set = knownSet;
			// After the novelty budget, whose swaps the popularity budget
			// then counts; under a novelty budget its swaps are new too. The
			// budget counts the picks that resolved: an empty slot can be
			// neither mainstream nor lifted.
			const popularity = popularityBudget(
				creativity,
				purpose,
				[...songs.values()].filter((song) => song.songId).length,
			);
			const popularitySwaps = popularity
				? await enforcePopularityBudget({
						budget: popularity,
						intent,
						songs: [...songs.values()],
						pool,
						caps,
						evidenceFor,
						accepts: (song) =>
							!budget || !set || familiarityOf(set, song) === "new",
					})
				: [];
			for (const song of popularitySwaps) {
				accept(song, "popularity");
				songs.set(song.id, await withEvidence(song));
			}
			signal.throwIfAborted();
			await rerankPlaylist({
				userId,
				signal,
				brief: prompt,
				intent,
				purpose,
				popularity,
				engine: otherEngine(engine),
				songs: [...songs.values()].map((song) =>
					set ? { ...song, familiarity: familiarityOf(set, song) } : song,
				),
				// Under a budget, a pool fill must not bring a known song back.
				pool: set
					? pool
							.map((song) => ({
								...song,
								familiarity: familiarityOf(set, song),
							}))
							.filter((song) => !budget || song.familiarity === "new")
					: pool,
				caps,
				evidenceFor,
				emit,
			});
			emit(
				budgetEvent({
					budget,
					set: knownSet,
					songs: [...finalSongs.values()],
					swapped: swaps.map((song) => song.id),
				}),
			);
			emit(
				popularityEvent({
					budget: popularity,
					evidence: await Promise.all(
						[...finalSongs.values()].flatMap((song) =>
							song.songId
								? [evidenceFor({ ...song, songId: song.songId })]
								: [],
						),
					),
					swapped: popularitySwaps.map((song) => song.id),
				}),
			);
			emit({
				kind: "complete",
				id: playlistId,
				songIds: [...finalSongs.keys()],
			});
			controller.close();
		},
	});

	return new Response(enrichedStream, {
		headers: {
			"Content-Type": "application/x-ndjson; charset=utf-8",
			"Cache-Control": "no-store",
		},
	});
}
