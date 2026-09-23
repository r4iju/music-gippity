/**
 * Songs in the listening order the rerank named. A song it did not name
 * (an unresolved slot, a late arrival) keeps its place after the named
 * ones, and numbering follows the new order so every consumer reads the
 * same sequence.
 */
export function applyOrder<T extends { id: string; order: number }>(
	songs: T[],
	ids: string[],
): T[] {
	const rank = new Map(ids.map((id, index) => [id, index]));
	return songs
		.map((song, index) => ({ song, index }))
		.sort((a, b) => {
			const ra = rank.get(a.song.id) ?? ids.length + a.index;
			const rb = rank.get(b.song.id) ?? ids.length + b.index;
			return ra - rb;
		})
		.map(({ song }, index) => ({ ...song, order: index + 1 }));
}
