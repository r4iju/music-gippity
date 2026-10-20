import type { Creativity } from "./creativity";
import type { Evidence, ListenerSource } from "./evidence";
import type { PopularityBudget } from "./playlist-stream";
import type { Purpose } from "./purpose";

/**
 * The listener count at which a recording counts as mainstream. Each source
 * counts its own user base, Last.fm's far larger than ListenBrainz's, so
 * each has its own threshold. Last.fm's sits between songs known beyond
 * their scene (Padam Padam 383k, Nightcall 1.25M) and scene staples
 * (Brokendate 244k, Roller Mobster 233k), near the 92nd percentile of
 * run 7's eval picks. ListenBrainz's, the fallback, sits near the 75th
 * percentile of the picks it counted (#51). Deezer's is a track rank, not
 * a count; asked last, it sits near the 90th percentile of the 533 saved
 * eval picks both Deezer and Last.fm counted, where it agrees with
 * Last.fm's split on 91% of them and errs about as often either way:
 * Flashback (rank 501k, Last.fm 271k) and Inspector Norse (538k, 265k)
 * above, Future Club (482k, 203k) and Looped (480k, 194k) below. A higher
 * rank agrees slightly more (92% at 550k) by missing half of Last.fm's
 * mainstream (#10).
 */
export const MAINSTREAM_LISTENERS: Record<ListenerSource, number> = {
	lastfm: 250000,
	listenbrainz: 5000,
	deezer: 500000,
};

/**
 * Which side of its source's threshold a recording falls on. A recording
 * no source counts is unknown, not low: it counts toward neither side of a
 * popularity budget.
 */
export type MainstreamStatus = "mainstream" | "not-mainstream" | "unknown";

export const mainstreamStatus = (
	listeners: Evidence["listeners"],
): MainstreamStatus => {
	if (listeners === null) return "unknown";
	return listeners.value >= MAINSTREAM_LISTENERS[listeners.source]
		? "mainstream"
		: "not-mainstream";
};

/**
 * How many mainstream recordings the playlist may hold. Creativity sets a
 * ceiling: none for Safe, room for a third of the picks below the
 * threshold for Balanced, three for Adventurous. A room of other people
 * needs to recognise the set, so purpose Room sets a floor of half the
 * picks instead.
 */
export function popularityBudget(
	creativity: Creativity,
	purpose: Purpose,
	trackCount: number,
): PopularityBudget | null {
	if (purpose === "room")
		return { maxMainstream: null, minMainstream: Math.ceil(trackCount / 2) };
	if (creativity === "safe") return null;
	return {
		maxMainstream:
			creativity === "balanced" ? trackCount - Math.ceil(trackCount / 3) : 3,
		minMainstream: null,
	};
}

/** How many recordings the playlist is away from its budget; 0 when it holds. */
export const budgetGap = (
	budget: PopularityBudget,
	mainstream: number,
): number =>
	Math.max(0, mainstream - (budget.maxMainstream ?? mainstream)) +
	Math.max(0, (budget.minMainstream ?? mainstream) - mainstream);

export interface PopularitySummary {
	recordings: number;
	/** Median listener count per source, over the recordings it counted. */
	median: Record<ListenerSource, number | null>;
	/** How many recordings each source counted. */
	counted: Record<ListenerSource, number>;
	mainstream: number;
	unknown: number;
}

const median = (values: number[]): number | null => {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? (sorted[mid] as number)
		: ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
};

export function summarizePopularity(
	evidence: (Evidence | undefined)[],
): PopularitySummary {
	const counts = evidence.map((e) => e?.listeners ?? null);
	const from = (source: ListenerSource) =>
		counts.flatMap((c) => (c?.source === source ? [c.value] : []));
	return {
		recordings: counts.length,
		median: {
			lastfm: median(from("lastfm")),
			listenbrainz: median(from("listenbrainz")),
			deezer: median(from("deezer")),
		},
		counted: {
			lastfm: from("lastfm").length,
			listenbrainz: from("listenbrainz").length,
			deezer: from("deezer").length,
		},
		mainstream: counts.filter((c) => mainstreamStatus(c) === "mainstream")
			.length,
		unknown: counts.filter((c) => c === null).length,
	};
}
