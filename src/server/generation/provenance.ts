import type { Song } from "~/contexts/playlist-provider";
import { artistKey } from "~/lib/caps";
import { familiarityOf } from "~/server/api/known";
import { type Research, restoreKnown } from "./research";

/** Rebuild product provenance from checkpointed research, including replacement recordings. */
export function annotateRecording<S extends Song>(
	song: S,
	research: Research,
): S {
	const { search } = research;
	const artists = [song.artist, ...(song.spotifyRecording?.artists ?? [])].map(
		artistKey,
	);
	const artist = search.artists.find((candidate) =>
		artists.includes(artistKey(candidate.name)),
	);
	const chart = search.tracks.find((candidate) =>
		artists.includes(artistKey(candidate.artist)),
	);
	const known = restoreKnown(research.known).set;
	return {
		...song,
		candidate: artist?.source ?? chart?.source,
		familiarity: known ? familiarityOf(known, song) : undefined,
	};
}
