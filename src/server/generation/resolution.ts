import { z } from "zod";
import { SlotCaps, takeFromPool } from "~/lib/caps";
import type { Intent } from "~/lib/intent";
import { type PlaylistLine, SongSchema } from "~/lib/playlist-stream";
import { UNRESOLVED } from "~/lib/resolution";
import { enrichSongWithSpotify, intoSlot } from "~/server/api/create-playlist";
import type { Curated } from "./curation";

const SourcedSchema = SongSchema.extend({
	source: z.enum(["recall", "candidates"]),
});
export const ResolvedSchema = z.object({
	name: z.string(),
	description: z.string(),
	songs: z.array(SourcedSchema),
	pool: z.array(SourcedSchema),
	unfilled: z.array(
		z.object({
			slot: z.object({ id: z.string(), order: z.number() }),
			kept: SourcedSchema.nullable(),
		}),
	),
	rejected: z.array(z.string()),
});
export type Resolved = z.infer<typeof ResolvedSchema>;

export async function resolveRecordings(
	curated: Curated,
	intent: Intent | null,
	trackCount: number,
	token: string,
	signal: AbortSignal,
	publish: (line: PlaylistLine) => Promise<unknown>,
): Promise<Resolved> {
	const caps = new SlotCaps(intent);
	const result: Resolved = {
		name: curated.name,
		description: curated.description,
		songs: [],
		pool: [],
		unfilled: curated.emptySlots.map((slot) => ({ slot, kept: null })),
		rejected: [],
	};
	const empty: Resolved["unfilled"] = [];
	// Sequential slot commitment makes cap winners deterministic; batches bound pool reads.
	for (const pick of curated.picks.slice(0, trackCount)) {
		signal.throwIfAborted();
		const enriched = await enrichSongWithSpotify(
			{ ...pick, kind: "song" },
			token,
			intent,
		);
		signal.throwIfAborted();
		if (
			enriched.status === "missing" ||
			(enriched.status === "found" && caps.conflicts(enriched.song))
		) {
			const kept = {
				...pick,
				songId: null,
				resolution: UNRESOLVED,
				origin: "pick" as const,
			};
			empty.push({ slot: pick, kept });
			result.rejected.push(`${pick.artist} - ${pick.title}`);
			await publish({ ...kept, kind: "song" });
		} else {
			const song = { ...enriched.song, origin: "pick" as const };
			caps.claim(song);
			result.songs.push(song);
			await publish({ ...song, kind: "song" });
		}
	}
	const extra = curated.picks.slice(trackCount);
	for (let start = 0; start < extra.length; start += 4) {
		signal.throwIfAborted();
		const found = await Promise.all(
			extra
				.slice(start, start + 4)
				.map((pick) =>
					enrichSongWithSpotify({ ...pick, kind: "song" }, token, intent),
				),
		);
		signal.throwIfAborted();
		result.pool.push(
			...found.flatMap((entry) =>
				entry.status === "found" ? [entry.song] : [],
			),
		);
	}
	for (const entry of [...empty, ...result.unfilled]) {
		const pooled = takeFromPool(result.pool, caps);
		if (pooled) {
			const song = { ...intoSlot(pooled, entry.slot), origin: "pool" as const };
			caps.claim(song);
			result.songs.push(song);
			await publish({ ...song, kind: "song" });
		}
	}
	// Anything not filled remains eligible for the existing paid repair continuation.
	result.unfilled = [...empty, ...result.unfilled].filter(
		(entry) => !result.songs.some((song) => song.id === entry.slot.id),
	);
	return ResolvedSchema.parse(result);
}
