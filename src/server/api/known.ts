import type { Song } from "~/contexts/playlist-provider";
import { artistKey } from "~/lib/caps";
import type { Familiarity, NoveltyEvent } from "~/lib/playlist-stream";
import type { Listener } from "~/server/api/listener";
import { type KnownRecording, SpotifyApiError } from "~/server/api/spotify";
import { drizzle, op, schema } from "~/server/drizzle";

/** What the listener already knows: recording keys (Spotify ids and ISRCs) and artists by key. */
export interface KnownSet {
	recordings: Set<string>;
	/** The display name, and how many known recordings are by the artist. */
	artists: Map<string, { name: string; recordings: number }>;
}

// Matches the saved-library cap, so neither source outweighs the other.
const APP_SONGS_CAP = 1000;

/**
 * Songs from the listener's most recent playlists in the app. They carry
 * no ISRC. Playlists have no timestamp, so recency is SQLite's rowid, which
 * grows with each insert.
 */
async function appRecordings(userId: string): Promise<KnownRecording[]> {
	const rows = await drizzle
		.select({ songId: schema.songs.songId, artist: schema.songs.artist })
		.from(schema.songs)
		.innerJoin(
			schema.playlists,
			op.eq(schema.songs.playlistId, schema.playlists.id),
		)
		.where(op.eq(schema.playlists.userId, userId))
		.orderBy(op.sql`${schema.playlists}.rowid desc`)
		.limit(APP_SONGS_CAP);
	return rows.map((row) => ({
		id: row.songId,
		isrc: null,
		artists: [row.artist],
	}));
}

// Only a refused grant is fixed by signing in again with the new scopes.
const causeOf = (error: unknown) =>
	error instanceof SpotifyApiError && [401, 403].includes(error.status)
		? "access"
		: "unavailable";

/**
 * The listener's known set with the event that reports it. Every source
 * must answer: a partial set would call a song new that the listener
 * knows, so any failure leaves no set and the event says why.
 */
export async function fetchKnown(
	listener: Listener,
	userId: string,
): Promise<{ set: KnownSet | null; event: NoveltyEvent }> {
	try {
		const sources = await Promise.all([
			listener.topTracks(),
			listener.savedTracks(),
			listener.recentTracks(),
			appRecordings(userId),
		]);
		const set: KnownSet = { recordings: new Set(), artists: new Map() };
		const ids = new Set<string>();
		for (const recording of sources.flat()) {
			if (recording.id) {
				ids.add(recording.id);
				set.recordings.add(recording.id);
			}
			if (recording.isrc) set.recordings.add(recording.isrc);
			for (const name of recording.artists) {
				const key = artistKey(name);
				const artist = set.artists.get(key);
				if (artist) artist.recordings += 1;
				else set.artists.set(key, { name, recordings: 1 });
			}
		}
		return {
			set,
			event: {
				kind: "novelty",
				status: "ok",
				knownRecordings: ids.size,
				knownArtists: set.artists.size,
			},
		};
	} catch (error) {
		return {
			set: null,
			event: {
				kind: "novelty",
				status: "error",
				cause: causeOf(error),
				error: error instanceof Error ? error.message : String(error),
			},
		};
	}
}

/** How well the listener knows a song: its recording, only its artist, or neither. */
export function familiarity(
	set: KnownSet,
	song: {
		songId?: string | null;
		isrc?: string | null;
		artists: string[];
	},
): Familiarity {
	if (
		(song.songId && set.recordings.has(song.songId)) ||
		(song.isrc && set.recordings.has(song.isrc))
	)
		return "known";
	return song.artists.some((artist) => set.artists.has(artistKey(artist)))
		? "known-artist"
		: "new";
}

/** A streamed or pooled song's familiarity, from every artist credited on it. */
export const familiarityOf = (set: KnownSet, song: Song): Familiarity =>
	familiarity(set, {
		songId: song.songId,
		isrc: song.resolution?.isrc,
		artists: [song.artist, ...(song.spotifyRecording?.artists ?? [])],
	});

/** The artists the listener knows best, most known recordings first. */
export const knownArtistNames = (set: KnownSet, limit: number): string[] =>
	[...set.artists.values()]
		.sort((a, b) => b.recordings - a.recordings)
		.slice(0, limit)
		.map((artist) => artist.name);
