import type { Song } from "~/contexts/playlist-provider";
import { type SlotCaps, takeFromPool } from "~/lib/caps";
import { type Evidence, hardRuleViolation } from "~/lib/evidence";
import type { Intent } from "~/lib/intent";
import type { RepairEvent } from "~/lib/playlist-stream";

export interface GroundedRepair<S extends Song = Song> {
	/** Pool recordings now in the violators' slots, keeping id and order. */
	replacements: S[];
	/** Violators the pool could not replace; the curator is asked as today. */
	unfilled: S[];
}

/**
 * The first pool recording that passes the caps and `accepts` and whose
 * evidence breaks no hard rule, removed from the pool. Recordings that
 * break one are dropped from the pool on the way.
 */
export async function takeGrounded<S extends Song>(
	pool: S[],
	caps: SlotCaps,
	intent: Intent | null,
	evidenceFor: (song: Song & { songId: string }) => Promise<Evidence>,
	accepts?: (song: S) => boolean,
): Promise<S | null> {
	while (true) {
		const pooled = takeFromPool(pool, caps, accepts);
		if (!pooled?.songId) return null;
		const evidence = await evidenceFor({ ...pooled, songId: pooled.songId });
		if (!hardRuleViolation(intent, evidence, pooled)) return pooled;
	}
}

/**
 * Replace every recording whose evidence breaks a hard rule with the first
 * pool recording that passes the caps and whose own evidence does not break
 * one. The evicted recording releases its caps so the pool may offer
 * another take by the same act.
 */
export async function repairFromEvidence<S extends Song>({
	intent,
	songs,
	pool,
	caps,
	evidenceFor,
	emit,
}: {
	intent: Intent | null;
	songs: S[];
	pool: S[];
	caps: SlotCaps;
	evidenceFor: (song: Song & { songId: string }) => Promise<Evidence>;
	emit: (event: RepairEvent) => void;
}): Promise<GroundedRepair<S>> {
	const replacements: S[] = [];
	const unfilled: S[] = [];
	for (const song of songs) {
		if (!song.songId || !song.evidence) continue;
		const violation = hardRuleViolation(intent, song.evidence, song);
		if (!violation) continue;
		caps.release(song.id);
		const pooled = await takeGrounded(pool, caps, intent, evidenceFor);
		const replacement = pooled && { ...pooled, id: song.id, order: song.order };
		// A violator the pool cannot replace stays and so keeps its keys.
		caps.claim(replacement ?? song);
		emit({
			kind: "repair",
			id: song.id,
			...violation,
			outcome: replacement ? "replaced" : "no-substitute",
			...(replacement
				? {
						replacement: {
							artist: replacement.artist,
							title: replacement.title,
						},
					}
				: {}),
		});
		if (replacement) replacements.push(replacement);
		else unfilled.push(song);
	}
	return { replacements, unfilled };
}
