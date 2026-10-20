import type { Song } from "~/contexts/playlist-provider";
import type { SlotCaps } from "~/lib/caps";
import type { Evidence } from "~/lib/evidence";
import type { Intent } from "~/lib/intent";
import type { PopularityBudget, PopularityEvent } from "~/lib/playlist-stream";
import {
	budgetGap,
	MAINSTREAM_LISTENERS,
	mainstreamStatus,
	summarizePopularity,
} from "~/lib/popularity";
import { takeGrounded } from "~/server/api/repair";

type Resolved = Song & { songId: string };

/** Which side of the threshold evidence puts the song, or unknown. */
export const mainstreamBy = (evidence: Evidence | null | undefined) =>
	mainstreamStatus(evidence?.listeners ?? null);

/**
 * Swap picks past the popularity budget for pool recordings on the other
 * side of the threshold that pass the caps, the hard rules and `accepts`.
 * Past a ceiling the earliest mainstream picks stay; under a floor the
 * picks least heard for their source go first. A recording no source
 * counts is on neither side: it is never evicted and never taken. A pick
 * the pool cannot replace stays, and the budget then reads as breached.
 */
export async function enforcePopularityBudget<S extends Song>({
	budget,
	intent,
	songs,
	pool,
	caps,
	evidenceFor,
	accepts = () => true,
}: {
	budget: PopularityBudget;
	intent: Intent | null;
	songs: S[];
	pool: S[];
	caps: SlotCaps;
	evidenceFor: (song: Resolved) => Promise<Evidence>;
	accepts?: (song: S) => boolean;
}): Promise<S[]> {
	const resolved = songs.filter((song): song is S & Resolved =>
		Boolean(song.songId),
	);
	const evidence = new Map(
		await Promise.all(
			[...resolved, ...pool.filter((song) => song.songId)].map(
				async (song) =>
					[
						song.songId,
						await evidenceFor({ ...song, songId: song.songId as string }),
					] as const,
			),
		),
	);
	const status = (song: Song) =>
		mainstreamBy(song.songId ? evidence.get(song.songId) : null);
	// Sources count on different scales, so a pick is ranked by how near
	// it comes to its own source's threshold.
	const nearness = (song: Song) => {
		const listeners = song.songId ? evidence.get(song.songId)?.listeners : null;
		return listeners
			? listeners.value / MAINSTREAM_LISTENERS[listeners.source]
			: 0;
	};

	let count = resolved.filter((song) => status(song) === "mainstream").length;
	const over = budget.maxMainstream !== null && count > budget.maxMainstream;
	const under = budget.minMainstream !== null && count < budget.minMainstream;
	if (!over && !under) return [];
	// Past a ceiling a mainstream pick makes way for one counted below the
	// threshold; under a floor it is the other way round.
	const leaving = over ? "mainstream" : "not-mainstream";
	const arriving = over ? "not-mainstream" : "mainstream";
	const evict = resolved
		.filter((song) => status(song) === leaving)
		.sort((a, b) =>
			over ? a.order - b.order : nearness(a) - nearness(b) || a.order - b.order,
		);
	if (over) evict.splice(0, budget.maxMainstream ?? 0);

	const swaps: S[] = [];
	for (const song of evict) {
		if (!budgetGap(budget, count)) break;
		caps.release(song.id);
		const replacement = await takeGrounded(
			pool,
			caps,
			intent,
			evidenceFor,
			(candidate) => status(candidate) === arriving && accepts(candidate),
		);
		if (!replacement) {
			caps.claim(song);
			continue;
		}
		const swap = { ...replacement, id: song.id, order: song.order };
		caps.claim(swap);
		swaps.push(swap);
		count += under ? 1 : -1;
	}
	return swaps;
}

/** The popularity line for the final playlist. */
export function popularityEvent({
	budget,
	evidence,
	swapped,
}: {
	budget: PopularityBudget | null;
	/** Evidence for each resolved song of the final playlist. */
	evidence: Evidence[];
	swapped: string[];
}): PopularityEvent {
	const counts = summarizePopularity(evidence);
	if (!budget) return { kind: "popularity", status: "uncapped", ...counts };
	return {
		kind: "popularity",
		status: budgetGap(budget, counts.mainstream) ? "breached" : "held",
		budget,
		...counts,
		swapped,
	};
}
