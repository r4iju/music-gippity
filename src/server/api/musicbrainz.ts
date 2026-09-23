import { env } from "~/env.mjs";
import type { ArtistCandidate } from "~/lib/playlist-stream";
import { RateLimiter } from "./evidence/rate-limit";

export const USER_AGENT =
	"music-gippity/1.0 (https://github.com/r4iju/music-gippity)";

// MusicBrainz requests wait their turn before their deadline starts, so
// they arrive at the pace of the limiter, one per interval. The limiter is
// per isolate and shared by candidates and evidence; MusicBrainz answers
// 503 when several isolates together exceed its limit.
export const musicbrainz = new RateLimiter(Number(env.MUSICBRAINZ_INTERVAL_MS));

const SEARCH_DEADLINE_MS = 5000;
// Who is tagged with a scene or signed to a label changes slowly.
const REVALIDATE_SECONDS = 60 * 60 * 24;
const SEARCH_LIMIT = 100;
const VARIOUS_ARTISTS = "89ad4ac3-39f7-470e-963a-56509c546377";
/** MusicBrainz names its placeholder artists in brackets: [unknown], [traditional]. */
const isPlaceholder = (name: string) => /^\[.*\]$/.test(name.trim());

/** Lucene phrase: MusicBrainz search treats quotes and backslashes as syntax. */
export const unquoted = (value: string) =>
	value.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
const phrase = (value: string) => `"${unquoted(value)}"`;

async function searchMusicBrainz<T>(
	entity: "artist" | "release",
	query: string,
): Promise<T> {
	// The deadline covers the wait for the limiter too: evidence for another
	// playlist can queue ahead, and the first song waits on this search.
	const controller = new AbortController();
	const timer = setTimeout(
		() =>
			controller.abort(new Error(`timed out after ${SEARCH_DEADLINE_MS} ms`)),
		SEARCH_DEADLINE_MS,
	);
	try {
		return await musicbrainz.run(async () => {
			const res = await fetch(
				`https://musicbrainz.org/ws/2/${entity}?query=${encodeURIComponent(query)}&limit=${SEARCH_LIMIT}&fmt=json`,
				{
					signal: controller.signal,
					headers: { Accept: "application/json", "User-Agent": USER_AGENT },
					next: { revalidate: REVALIDATE_SECONDS },
				} as RequestInit,
			);
			if (!res.ok) throw new Error(`MusicBrainz HTTP ${res.status}`);
			return (await res.json()) as T;
		}, controller.signal);
	} catch (error) {
		if (controller.signal.aborted) throw controller.signal.reason;
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

interface MusicBrainzArtist {
	id: string;
	name: string;
	area?: { name?: string } | null;
	tags?: { name: string; count: number }[];
}

/** The query that finds artists tagged with any of the scene's tags, in the area when given. */
export const tagQuery = (tags: string[], area: string | null): string => {
	const tagged = tags.map((tag) => `tag:${phrase(tag)}`).join(" OR ");
	return area ? `(${tagged}) AND area:${phrase(area)}` : tagged;
};

/** Artists MusicBrainz tags with the scene, most relevant first. */
export async function artistsByTag(
	tags: string[],
	area: string | null,
): Promise<ArtistCandidate[]> {
	const body = await searchMusicBrainz<{ artists?: MusicBrainzArtist[] }>(
		"artist",
		tagQuery(tags, area),
	);
	return (body.artists ?? [])
		.filter((artist) => !isPlaceholder(artist.name))
		.map((artist) => ({
			name: artist.name,
			mbid: artist.id,
			source: "tag",
			area: artist.area?.name ?? null,
			tags: [...(artist.tags ?? [])]
				.sort((a, b) => b.count - a.count)
				.slice(0, 3)
				.map((tag) => tag.name),
			label: null,
		}));
}

export const labelQuery = (label: string): string => `label:${phrase(label)}`;

interface MusicBrainzRelease {
	"artist-credit"?: { artist?: { id: string; name: string } }[];
}

/** The artists credited on the label's releases, in the order MusicBrainz ranks them. */
export async function artistsByLabel(
	label: string,
): Promise<ArtistCandidate[]> {
	const body = await searchMusicBrainz<{ releases?: MusicBrainzRelease[] }>(
		"release",
		labelQuery(label),
	);
	const seen = new Set<string>();
	const artists: ArtistCandidate[] = [];
	for (const release of body.releases ?? [])
		for (const credit of release["artist-credit"] ?? []) {
			const artist = credit.artist;
			if (!artist || artist.id === VARIOUS_ARTISTS || seen.has(artist.id))
				continue;
			seen.add(artist.id);
			artists.push({
				name: artist.name,
				mbid: artist.id,
				source: "label",
				area: null,
				tags: [],
				label,
			});
		}
	return artists;
}
