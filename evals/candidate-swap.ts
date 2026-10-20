import { artistKey } from "~/lib/caps";
import type { ArtistCandidate, TrackCandidate } from "~/lib/playlist-stream";
import type { CandidatePool } from "~/server/api/candidates";

/** What the curator is offered: artists, and chart tracks by artist. */
export interface Offer {
	artists: readonly ArtistCandidate[];
	tracks: readonly TrackCandidate[];
}

const offeredArtists = (offer: Offer): Set<string> =>
	new Set([
		...offer.artists.map((artist) => artistKey(artist.name)),
		...offer.tracks.map((track) => artistKey(track.artist)),
	]);

/**
 * `found` with another case's offer in its place. The event carries the
 * swapped offer too, so the run records what the curator actually saw;
 * the lookups and their timings stay those of the real search.
 */
export function swapPool(found: CandidatePool, donor: Offer): CandidatePool {
	const artists = [...donor.artists];
	const tracks = [...donor.tracks];
	return { artists, tracks, event: { ...found.event, artists, tracks } };
}

/**
 * The saved run whose offer shares the fewest artists with the target's,
 * from another brief (cases that differ only in creativity share one); the
 * earliest wins a tie. Undefined when no other brief offered anything.
 */
export function pickDonor<R extends { brief: string; candidates?: Offer }>(
	target: R,
	runs: readonly R[],
): R | undefined {
	const own = target.candidates
		? offeredArtists(target.candidates)
		: new Set<string>();
	let best: { run: R; shared: number } | undefined;
	for (const run of runs) {
		if (run.brief === target.brief || !run.candidates) continue;
		const keys = offeredArtists(run.candidates);
		if (!keys.size) continue;
		const shared = [...keys].filter((key) => own.has(key)).length;
		if (!best || shared < best.shared) best = { run, shared };
	}
	return best?.run;
}

/** A final pick, with the artists credited on its recording when it resolved. */
interface Pick {
	artist: string;
	spotifyRecording?: { artists: readonly string[] } | null;
}

export interface PickMatches {
	total: number;
	/** Picks by an artist only the real pool offered. */
	real: number;
	/** Picks by an artist only the swapped pool offered. */
	swapped: number;
	/** Picks by an artist both pools offered. */
	both: number;
	neither: number;
}

/**
 * How many final picks match the real pool versus the swapped one. A pick
 * matches a pool by its artist or any artist credited on its recording, as
 * the route matches candidates.
 */
export function matchPicks(
	songs: readonly Pick[],
	real: Offer,
	swapped: Offer,
): PickMatches {
	const counts: PickMatches = {
		total: songs.length,
		real: 0,
		swapped: 0,
		both: 0,
		neither: 0,
	};
	const match = poolMatch(real, swapped);
	for (const song of songs) counts[match(song)] += 1;
	return counts;
}

/** Which of the two pools a pick matches. */
export function poolMatch(real: Offer, swapped: Offer) {
	const realKeys = offeredArtists(real);
	const swappedKeys = offeredArtists(swapped);
	return (song: Pick): "real" | "swapped" | "both" | "neither" => {
		const keys = [song.artist, ...(song.spotifyRecording?.artists ?? [])].map(
			artistKey,
		);
		const inReal = keys.some((key) => realKeys.has(key));
		const inSwapped = keys.some((key) => swappedKeys.has(key));
		if (inReal && inSwapped) return "both";
		if (inReal) return "real";
		return inSwapped ? "swapped" : "neither";
	};
}
