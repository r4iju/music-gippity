import type { NotFoundSong, Song } from "~/contexts/playlist-provider";
import type { Intent } from "~/lib/intent";
import {
	baseTitle,
	chooseSearchHit,
	type Resolution,
	releaseYear,
	type SearchHit,
	UNRESOLVED,
} from "~/lib/resolution";
import {
	RateLimitGate,
	SpotifyApiError,
	SpotifyTimeout,
} from "~/server/api/spotify-gate";
import { logger } from "~/utils";

export { SpotifyApiError, SpotifyTimeout } from "~/server/api/spotify-gate";

interface GenericSpotifyResponse<T> {
	body: T;
	headers: globalThis.Headers;
	statusCode: number;
}

// Long enough for a rate-limit hold of a few seconds to lift and the call to
// retry; a listener saving a playlist waits at most this long per call.
const CALL_BUDGET_MS = 10000;
const gate = new RateLimitGate();

async function spotifyApi<T = unknown>(
	path: string,
	token: string,
	method = "GET",
	body?: unknown,
	budgetMs = CALL_BUDGET_MS,
): Promise<GenericSpotifyResponse<T>> {
	const url = `https://api.spotify.com/v1${path}`;
	logger.debug(`Making Spotify API request: [${method}] ${url}`);
	let response: Response;
	try {
		response = await gate.run(async (signal) => {
			const answer = await fetch(url, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: body ? JSON.stringify(body) : undefined,
				signal,
			});
			// The body is read within the budget too: a stalled stream is a
			// timeout, not a call that never ends.
			const text = await answer.text();
			return new Response(text || null, {
				status: answer.status,
				statusText: answer.statusText,
				headers: answer.headers,
			});
		}, budgetMs);
	} catch (err) {
		if (err instanceof SpotifyTimeout)
			logger.warning(`Spotify API call ${err.message}: [${method}] ${url}`);
		else if (err instanceof Error)
			logger.error(`Failed fetching Spotify API [${method}] ${url}`, err);
		throw err;
	}

	logger.debug(
		`Received response: [${method}] ${url} - Status ${response.status}`,
	);

	if (!response.ok) {
		const errorMessage = await response.text();
		logger.error(
			`Spotify API Error: [${method}] ${url} returned status ${response.status}. Message: ${errorMessage}`,
		);
		throw new SpotifyApiError(
			response.status,
			`Spotify API Error. status: ${response.status}, message: ${errorMessage}`,
		);
	}

	let responseBody: T;

	if (response.status === 204) {
		// return empty object for 204 No Content
		responseBody = {} as T;
	} else {
		responseBody = (await response.json()) as T;
	}

	return {
		body: responseBody,
		headers: response.headers,
		statusCode: response.status,
	};
}

type ExternalUrls = {
	spotify: string;
};

type Artist = {
	external_urls: ExternalUrls;
	href: string;
	id: string;
	name: string;
	type: string;
	uri: string;
};

type Album = {
	album_type: string;
	artists: Artist[];
	available_markets: string[];
	external_urls: ExternalUrls;
	href: string;
	id: string;
	images: {
		height: number;
		url: string;
		width: number;
	}[];
	name: string;
	release_date: string;
	release_date_precision: string;
	total_tracks: number;
	type: string;
	uri: string;
};

type Track = {
	album: Album;
	artists: Artist[];
	available_markets: string[];
	disc_number: number;
	duration_ms: number;
	explicit: boolean;
	external_ids?: {
		isrc?: string;
	};
	external_urls: ExternalUrls;
	href: string;
	id: string;
	is_local: boolean;
	name: string;
	preview_url: string | null;
	track_number: number;
	type: string;
	uri: string;
};

type FindTrackProps = {
	song: NotFoundSong;
	token: string;
	intent?: Intent | null;
};

interface TracksResponseBody {
	tracks: {
		href: string;
		items: Track[];
		limit: number;
		next: string | null;
		offset: number;
		previous: string | null;
		total: number;
	};
}

async function searchTracks(
	query: string,
	token: string,
	budgetMs?: number,
): Promise<Track[]> {
	const response = await spotifyApi<TracksResponseBody>(
		`/search?q=${encodeURIComponent(query)}&type=track&limit=10`,
		token,
		"GET",
		undefined,
		budgetMs,
	);
	return response.body.tracks.items;
}

/** A recording the listener already has, as the known set keys it. */
export interface KnownRecording {
	// Null for local files in recent plays and songs saved before they resolved.
	id: string | null;
	isrc: string | null;
	artists: string[];
}

type KnownTrack = Pick<Track, "artists" | "external_ids"> & {
	id: string | null;
};
const known = (track: KnownTrack): KnownRecording => ({
	id: track.id,
	isrc: track.external_ids?.isrc ?? null,
	artists: track.artists.map((artist) => artist.name),
});

const LIBRARY_PAGE = 50;
// Enough to recognise a listener's staples. Pages after the first go out a
// few at a time: each generation also needs Spotify's rate budget for
// resolving picks moments later.
const LIBRARY_CAP = 1000;
const LIBRARY_CONCURRENCY = 5;

/** The listener's saved tracks, newest first, up to the cap. */
export async function savedTracks(token: string): Promise<KnownRecording[]> {
	const page = (offset: number) =>
		spotifyApi<{ items: { track: KnownTrack }[]; total: number }>(
			`/me/tracks?limit=${LIBRARY_PAGE}&offset=${offset}`,
			token,
		);
	const first = await page(0);
	const total = Math.min(first.body.total, LIBRARY_CAP);
	const offsets = Array.from(
		{ length: Math.max(0, Math.ceil(total / LIBRARY_PAGE) - 1) },
		(_, index) => (index + 1) * LIBRARY_PAGE,
	);
	const pages = [first];
	for (let i = 0; i < offsets.length; i += LIBRARY_CONCURRENCY)
		pages.push(
			...(await Promise.all(
				offsets.slice(i, i + LIBRARY_CONCURRENCY).map(page),
			)),
		);
	return pages.flatMap((response) =>
		response.body.items.map((item) => known(item.track)),
	);
}

/** The listener's top tracks over the last month and the last six months. */
export async function topTracks(token: string): Promise<KnownRecording[]> {
	const ranges = await Promise.all(
		["short_term", "medium_term"].map((range) =>
			spotifyApi<{ items: KnownTrack[] }>(
				`/me/top/tracks?limit=50&time_range=${range}`,
				token,
			),
		),
	);
	return ranges.flatMap((response) => response.body.items.map(known));
}

/** The listener's last fifty plays. */
export async function recentTracks(token: string): Promise<KnownRecording[]> {
	const response = await spotifyApi<{ items: { track: KnownTrack }[] }>(
		"/me/player/recently-played?limit=50",
		token,
	);
	return response.body.items.map((item) => known(item.track));
}

const toHit = (track: Track): SearchHit => ({
	id: track.id,
	title: track.name,
	artists: track.artists.map((artist) => artist.name),
	releaseDate: track.album.release_date,
	isrc: track.external_ids?.isrc ?? null,
});

export const findSpotifyTrack = async ({
	song,
	token,
	intent = null,
}: FindTrackProps): Promise<Song> => {
	logger.info(`Searching for Spotify track: ${song.artist} - ${song.title}`);
	// The fielded query is precise but strict about spelling; fall back to a
	// plain-text search so deep cuts with slightly different metadata resolve.
	// A clean title match ends the search; anything weaker is kept only until
	// a later query does better.
	const attempts = [
		`artist:${song.artist} track:${song.title}`,
		`${song.artist} ${song.title}`,
		...(baseTitle(song.title) !== song.title
			? [`artist:${song.artist} track:${baseTitle(song.title)}`]
			: []),
	];
	let track: Track | undefined;
	let resolution: Resolution = UNRESOLVED;
	let bestScore = Number.NEGATIVE_INFINITY;
	for (const query of attempts) {
		const tracks = await searchTracks(query, token);
		const best = chooseSearchHit(song, tracks.map(toHit), intent);
		if (!best || best.score <= bestScore) continue;
		track = tracks.find((t) => t.id === best.hit.id);
		resolution = best.resolution;
		bestScore = best.score;
		if (
			resolution.tier === "exact" ||
			(resolution.tier === "normalized" && !resolution.drift)
		)
			break;
	}

	const trackData: {
		songId: string | null;
		previewUrl: string | null;
		albumTitle: string | null;
		albumYear: number | null;
		albumImage: string | null;
	} = {
		songId: null,
		previewUrl: "",
		albumTitle: null,
		albumYear: null,
		albumImage: null,
	};

	if (track) {
		trackData.songId = track.id ?? null;
		trackData.previewUrl = track.preview_url ?? null;
		trackData.albumImage = track.album.images[0]?.url ?? null;
		trackData.albumTitle = track.album.name;
		trackData.albumYear = releaseYear(track.album.release_date);
		logger.info(
			`Found Spotify track ID ${track.id} for ${song.artist} - ${song.title} (${resolution.tier}${resolution.drift ? ", version drift" : ""})`,
		);
	} else {
		logger.warning(`No Spotify track found for ${song.artist} - ${song.title}`);
	}

	return {
		...song,
		...trackData,
		resolution,
		...(track
			? {
					spotifyRecording: {
						title: track.name,
						artists: track.artists.map((artist) => artist.name),
						albumId: track.album.id,
						durationMs: track.duration_ms,
					},
				}
			: {}),
	};
};

interface CreatePlaylistProps {
	name: string;
	description: string;
	token: string;
}

export interface PlaylistResponse {
	id: string;
	publicHref: string;
	uri: string;
}

interface PlaylistResponseBody {
	id: string;
	external_urls: ExternalUrls;
	uri: string;
}

export const createSpotifyPlaylist = async ({
	name,
	description,
	token,
}: CreatePlaylistProps): Promise<PlaylistResponse> => {
	logger.info(`Creating Spotify playlist: ${name}`);
	const response = await spotifyApi<PlaylistResponseBody>(
		"/me/playlists",
		token,
		"POST",
		{
			name,
			description,
			public: false,
		},
	);

	logger.info(`Created Spotify playlist with ID: ${response.body.id}`);
	return {
		id: response.body.id,
		publicHref: response.body.external_urls.spotify,
		uri: response.body.uri,
	};
};

interface AddPlaylistProps {
	trackIds: string[];
	playlistId: string;
	token: string;
}

interface SnapshotResponseBody {
	snapshot_id: string;
}

export const addTracksToPlaylist = async ({
	playlistId,
	trackIds,
	token,
}: AddPlaylistProps): Promise<string> => {
	logger.info(
		`Adding ${trackIds.length} track(s) to Spotify playlist ${playlistId}`,
	);
	const response = await spotifyApi<SnapshotResponseBody>(
		`/playlists/${playlistId}/items`,
		token,
		"POST",
		{
			uris: trackIds.map((id) => `spotify:track:${id}`),
		},
	);

	logger.info(
		`Tracks added to playlist ${playlistId}. Snapshot ID: ${response.body.snapshot_id}`,
	);
	return response.body.snapshot_id;
};

interface PlayTrackProps {
	trackIds: string[];
	token: string;
}

export const playTrack = async ({
	trackIds,
	token,
}: PlayTrackProps): Promise<void> => {
	logger.info(`Playing ${trackIds.length} track(s) on Spotify`);
	await spotifyApi("/me/player/play", token, "PUT", {
		uris: trackIds.map((id) => `spotify:track:${id}`),
	});
};

interface PauseTrackProps {
	token: string;
}

export const pauseTrack = async ({ token }: PauseTrackProps): Promise<void> => {
	logger.info("Pausing playback on Spotify");
	await spotifyApi("/me/player/pause", token, "PUT");
};
