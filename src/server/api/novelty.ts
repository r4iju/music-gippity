import type { Song } from "~/contexts/playlist-provider";
import type { SlotCaps } from "~/lib/caps";
import type { Evidence } from "~/lib/evidence";
import type { Intent } from "~/lib/intent";
import type { BudgetEvent, NoveltyBudget } from "~/lib/playlist-stream";
import { PURPOSE, type Purpose } from "~/lib/purpose";
import { familiarityOf, type KnownSet } from "~/server/api/known";
import { takeGrounded } from "~/server/api/repair";

/** The purpose's novelty budget for a playlist of this length, if it has one. */
export function noveltyBudget(
	purpose: Purpose,
	trackCount: number,
): NoveltyBudget | null {
	const rule = PURPOSE[purpose].novelty;
	return (
		rule && {
			knownTracks: rule.knownTracks,
			knownArtists: Math.floor(trackCount * rule.knownArtistShare),
		}
	);
}

/** Known tracks, and songs by known artists (known tracks included), among resolved songs. */
export function familiarCounts(songs: Song[]) {
	const resolved = songs.filter((song) => song.songId);
	return {
		known: resolved.filter((song) => song.familiarity === "known").length,
		byKnownArtist: resolved.filter(
			(song) => song.familiarity && song.familiarity !== "new",
		).length,
	};
}

/**
 * Swap every resolved song past the budget for a new pool recording that
 * passes the caps and the hard rules. Slots are walked in order, so the
 * earliest known picks are the ones that stay. A song the pool cannot
 * replace stays too, and the budget then reads as breached.
 */
export async function enforceNoveltyBudget<S extends Song>({
	budget,
	set,
	intent,
	songs,
	pool,
	caps,
	evidenceFor,
}: {
	budget: NoveltyBudget;
	set: KnownSet;
	intent: Intent | null;
	songs: Song[];
	pool: S[];
	caps: SlotCaps;
	evidenceFor: (song: Song & { songId: string }) => Promise<Evidence>;
}): Promise<S[]> {
	const swaps: S[] = [];
	let known = 0;
	let byKnownArtist = 0;
	const isNew = (song: Song) => familiarityOf(set, song) === "new";
	for (const song of [...songs].sort((a, b) => a.order - b.order)) {
		// Read from the set: repaired songs reach here without the flag.
		const familiarity = familiarityOf(set, song);
		if (!song.songId || familiarity === "new") continue;
		const over =
			(familiarity === "known" && known >= budget.knownTracks) ||
			byKnownArtist >= budget.knownArtists;
		if (over) {
			caps.release(song.id);
			const replacement = await takeGrounded(
				pool,
				caps,
				intent,
				evidenceFor,
				isNew,
			);
			if (replacement) {
				const swap = {
					...replacement,
					id: song.id,
					order: song.order,
					familiarity: "new" as const,
				};
				caps.claim(swap);
				swaps.push(swap);
				continue;
			}
			caps.claim(song);
		}
		if (familiarity === "known") known += 1;
		byKnownArtist += 1;
	}
	return swaps;
}

/** The budget line for the final playlist. */
export function budgetEvent({
	budget,
	set,
	songs,
	swapped,
}: {
	budget: NoveltyBudget | null;
	set: KnownSet | null;
	songs: Song[];
	swapped: string[];
}): BudgetEvent {
	if (!set) return { kind: "budget", status: "unknown" };
	const counts = familiarCounts(songs);
	if (!budget) return { kind: "budget", status: "uncapped", ...counts };
	return {
		kind: "budget",
		status:
			counts.known <= budget.knownTracks &&
			counts.byKnownArtist <= budget.knownArtists
				? "held"
				: "breached",
		budget,
		...counts,
		swapped,
	};
}
