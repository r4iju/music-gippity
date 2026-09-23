/** Intentionally excludes briefs, provider payloads, tokens and arbitrary errors. */
export function generationEvent(
	event: string,
	fields: {
		playlistId?: string;
		generationId?: string;
		workerId?: string;
		phase?: string;
		attempt?: string;
		revision?: number;
		status?: string;
	},
) {
	console.info(
		JSON.stringify({ component: "playlist-generation", event, ...fields }),
	);
}
