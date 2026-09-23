import { env } from "~/env.mjs";
import { baseTitle } from "~/lib/resolution";
import { USER_AGENT } from "./musicbrainz";

// Last.fm asks for about five calls a second per key. Candidates are
// counted in bursts of dozens, so their calls run a few at a time, per
// isolate. Evidence asks a couple of calls a song as songs resolve and
// keeps out of that queue, so another playlist's counting cannot stall it.
const CANDIDATE_CONCURRENCY = 5;
// Listener counts, similar artists and charts change slowly.
const REVALIDATE_SECONDS = 60 * 60 * 24 * 30;
// Last.fm sends its error codes in the body, whatever the HTTP status;
// this one means it has no record of the track or artist.
const NOT_FOUND = 6;

let running = 0;
const waiting: (() => void)[] = [];

/** Runs the task once a slot is free; a finished task hands its slot on. */
async function inTurn<T>(task: () => Promise<T>): Promise<T> {
	if (running < CANDIDATE_CONCURRENCY) running += 1;
	else await new Promise<void>((resolve) => waiting.push(resolve));
	try {
		return await task();
	} finally {
		const next = waiting.shift();
		if (next) next();
		else running -= 1;
	}
}

export interface CallOptions {
	signal?: AbortSignal;
	/** Whether the call waits its turn in the candidate queue. */
	queued?: boolean;
}

export class LastfmError extends Error {
	constructor(
		readonly code: number | null,
		message: string,
	) {
		super(message);
	}

	get notFound(): boolean {
		return this.code === NOT_FOUND;
	}
}

export const hasLastfmKey = (): boolean => Boolean(env.LASTFM_API_KEY);

/** A list call Last.fm answers "not found" to, as an empty list. */
const orNone = <T>(error: unknown): T[] => {
	if (error instanceof LastfmError && error.notFound) return [];
	throw error;
};

async function call<T>(
	method: string,
	params: Record<string, string>,
	{ signal, queued = false }: CallOptions = {},
): Promise<T> {
	const key = env.LASTFM_API_KEY;
	if (!key) throw new LastfmError(null, "LASTFM_API_KEY is not set");
	const request = async () => {
		signal?.throwIfAborted();
		const query = new URLSearchParams({
			method,
			...params,
			api_key: key,
			format: "json",
		});
		const res = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}`, {
			signal,
			headers: { Accept: "application/json", "User-Agent": USER_AGENT },
			next: { revalidate: REVALIDATE_SECONDS },
		} as RequestInit);
		const body = (await res.json().catch(() => ({}))) as T & {
			error?: number;
			message?: string;
		};
		if (res.status === 404) throw new LastfmError(NOT_FOUND, "Not found");
		if (body.error)
			throw new LastfmError(body.error, body.message ?? `error ${body.error}`);
		if (!res.ok) throw new LastfmError(null, `Last.fm HTTP ${res.status}`);
		return body;
	};
	return queued ? inTurn(request) : request();
}

const count = (value: string | undefined): number | null =>
	// A page nobody has played counts 0, which says nothing of the song.
	Number.parseInt(value ?? "", 10) || null;

export interface LastfmTrack {
	tags: string[];
	listeners: number | null;
}

async function trackInfoAs(
	artist: string,
	title: string,
	options: CallOptions,
): Promise<LastfmTrack | null> {
	try {
		const body = await call<{
			track?: {
				listeners?: string;
				// A single tag arrives as an object rather than a one-item list.
				toptags?: { tag?: { name: string } | { name: string }[] };
			};
		}>("track.getinfo", { artist, track: title, autocorrect: "1" }, options);
		if (!body.track) return null;
		const tags = [body.track.toptags?.tag ?? []].flat().map((tag) => tag.name);
		const listeners = count(body.track.listeners);
		return tags.length || listeners !== null ? { tags, listeners } : null;
	} catch (error) {
		if (error instanceof LastfmError && error.notFound) return null;
		throw error;
	}
}

/**
 * The song's tags and listeners under its title and, when that carries a
 * suffix, its base title; the answer with more listeners wins. Last.fm
 * keeps a thin page for a remaster or an edit ("Tides - 2022 Remaster"
 * 5.9k listeners, "Tides" 31k), yet for a remix or a featured version the
 * full title is often the song people play ("Baddadan (feat. …)" 212k,
 * "Baddadan" 7.8k). Null when Last.fm has no record under either; a
 * failure under one title costs only that title.
 */
export async function trackInfo(
	artist: string,
	title: string,
	options: CallOptions = {},
): Promise<LastfmTrack | null> {
	const base = baseTitle(title);
	const settled = await Promise.allSettled(
		[title, ...(base && base !== title ? [base] : [])].map((name) =>
			trackInfoAs(artist, name, options),
		),
	);
	const failure = settled.find((answer) => answer.status === "rejected");
	if (failure && settled.every((answer) => answer.status === "rejected"))
		throw failure.reason;
	const found = settled.map((answer) =>
		answer.status === "fulfilled" ? answer.value : null,
	);
	return found.reduce<LastfmTrack | null>(
		(a, b) => (!b || (a && (a.listeners ?? 0) >= (b.listeners ?? 0)) ? a : b),
		null,
	);
}

/** Artists Last.fm's listeners play alongside this one, closest first. */
export async function similarArtists(
	artist: string,
	limit: number,
	signal?: AbortSignal,
): Promise<{ name: string; mbid: string | null }[]> {
	const body = await call<{
		similarartists?: { artist?: { name: string; mbid?: string }[] };
	}>(
		"artist.getsimilar",
		{ artist, limit: `${limit}`, autocorrect: "1" },
		{ signal, queued: true },
	).catch(orNone);
	return (
		Array.isArray(body) ? [] : (body.similarartists?.artist ?? [])
	).flatMap((similar) =>
		similar.name?.trim()
			? [{ name: similar.name, mbid: similar.mbid || null }]
			: [],
	);
}

/** The tracks most played under a tag, most played first. */
export async function tagTopTracks(
	tag: string,
	limit: number,
	signal?: AbortSignal,
): Promise<{ artist: string; title: string }[]> {
	const body = await call<{
		tracks?: { track?: { name: string; artist?: { name?: string } }[] };
	}>(
		"tag.gettoptracks",
		{ tag, limit: `${limit}` },
		{
			signal,
			queued: true,
		},
	).catch(orNone);
	return (Array.isArray(body) ? [] : (body.tracks?.track ?? [])).flatMap(
		(track) =>
			track.artist?.name
				? [{ artist: track.artist.name, title: track.name }]
				: [],
	);
}

/** Listeners of the artist's most played track: how widely heard their best-known song is. */
export async function topTrackListeners(
	artist: string,
	signal?: AbortSignal,
): Promise<number | null> {
	try {
		const body = await call<{
			toptracks?: { track?: { listeners?: string }[] };
		}>(
			"artist.gettoptracks",
			{ artist, limit: "1", autocorrect: "1" },
			{ signal, queued: true },
		);
		return count(body.toptracks?.track?.[0]?.listeners);
	} catch (error) {
		if (error instanceof LastfmError && error.notFound) return null;
		throw error;
	}
}
