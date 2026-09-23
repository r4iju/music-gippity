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
 * percentile of the picks it counted (#51).
 */
export const MAINSTREAM_LISTENERS: Record<ListenerSource, number> = {
	lastfm: 250000,
	listenbrainz: 5000,
};

/** A recording no source counts is treated as not mainstream. */
export const isMainstream = (listeners: Evidence["listeners"]): boolean =>
	listeners !== null &&
	listeners.value >= MAINSTREAM_LISTENERS[listeners.source];

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
			listenbrainz: median(from("listenbrainz")),
			lastfm: median(from("lastfm")),
		},
		mainstream: counts.filter(isMainstream).length,
		unknown: counts.filter((c) => c === null).length,
	};
}
